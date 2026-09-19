// Times the review, save and export waits for the 5,000-row sample against a deployed app, checks totals, and writes evidence files.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { decimalToUnits } from "../lib/rules/money";

type Args = { url: string; runs: number; label: string; file: string; insertMode: string | null; waitIdleSeconds: number };

type RunResult = {
  run: number;
  kind: "first" | "repeat";
  offerId: string;
  uploadMs: number;
  reviewPageMs: number;
  reviewWaitMs: number;
  saveMs: number;
  exportMs: number;
  exportBytes: number;
  serverTiming: Record<string, number>;
  pieces: number;
  supplierValue: string;
  csvLines: number;
  csvPieces: number;
  csvSupplierValue: string;
  totalsCorrect: boolean;
};

const EXPECTED = { pieces: 62_444, supplierValue: "187214.50", lines: 5000 };

function parseArgs(): Args {
  const get = (name: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? null : process.argv[index + 1];
  };
  const url = get("url");
  if (!url) throw new Error("Usage: npx tsx scripts/bench.ts --url https://your-app.vercel.app [--runs 3] [--label production] [--insert-mode row] [--wait-idle 600]");
  return {
    url: url.replace(/\/$/, ""),
    runs: Number(get("runs") ?? 3),
    label: get("label") ?? "production",
    file: get("file") ?? "fixtures/03-northstar-5000-rows.xlsx",
    insertMode: get("insert-mode"),
    waitIdleSeconds: Number(get("wait-idle") ?? 0),
  };
}

async function timed<T>(action: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await action();
  return { ms: Math.round(performance.now() - start), value };
}

function readServerTiming(header: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const part of (header ?? "").split(",")) {
    const match = /^\s*([\w-]+);dur=([\d.]+)/.exec(part);
    if (match) result[match[1]] = Number(match[2]);
  }
  return result;
}

function centsToText(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function sumCsv(text: string): { lines: number; pieces: number; supplierValue: string } {
  const rows = text.replace(/^﻿/, "").trim().split("\r\n").slice(1).map((line) => line.split(","));
  let pieces = 0;
  let cents = 0n;
  for (const row of rows) {
    pieces += Number(row[4]);
    cents += BigInt(decimalToUnits(row[6])! / 100);
  }
  return { lines: rows.length, pieces, supplierValue: centsToText(cents) };
}

async function runOnce(args: Args, file: Buffer, run: number): Promise<RunResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)]), basename(args.file));
  const headers: Record<string, string> = { "Idempotency-Key": randomUUID() };
  if (args.insertMode) headers["X-Insert-Mode"] = args.insertMode;

  const upload = await timed(async () => {
    const response = await fetch(`${args.url}/api/offers`, { method: "POST", body: form, headers });
    const body = await response.json();
    if (response.status !== 201) throw new Error(`Upload failed: HTTP ${response.status} ${JSON.stringify(body)}`);
    return { body, serverTiming: readServerTiming(response.headers.get("server-timing")) };
  });
  const offerId: string = upload.value.body.offerId;

  const reviewPage = await timed(async () => {
    const response = await fetch(`${args.url}/offers/${offerId}`, { cache: "no-store" });
    await response.text();
    if (!response.ok) throw new Error(`Review page failed: HTTP ${response.status}`);
  });

  const save = await timed(async () => {
    const response = await fetch(`${args.url}/api/offers/${offerId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Save failed: HTTP ${response.status} ${JSON.stringify(body)}`);
    return body;
  });

  const exported = await timed(async () => {
    const response = await fetch(`${args.url}/api/offers/${offerId}/export.csv`, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
    return text;
  });

  const totals = save.value.totals;
  const csv = sumCsv(exported.value);
  const totalsCorrect =
    totals.pieces === EXPECTED.pieces &&
    totals.supplierValue === EXPECTED.supplierValue &&
    csv.lines === EXPECTED.lines &&
    csv.pieces === EXPECTED.pieces &&
    csv.supplierValue === EXPECTED.supplierValue;

  return {
    run,
    kind: run === 1 ? "first" : "repeat",
    offerId,
    uploadMs: upload.ms,
    reviewPageMs: reviewPage.ms,
    reviewWaitMs: upload.ms + reviewPage.ms,
    saveMs: save.ms,
    exportMs: exported.ms,
    exportBytes: Buffer.byteLength(exported.value),
    serverTiming: upload.value.serverTiming,
    pieces: totals.pieces,
    supplierValue: totals.supplierValue,
    csvLines: csv.lines,
    csvPieces: csv.pieces,
    csvSupplierValue: csv.supplierValue,
    totalsCorrect,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function toMarkdown(args: Args, results: RunResult[], startedAt: string): string {
  const repeats = results.filter((r) => r.kind === "repeat");
  const st = (r: RunResult, key: string) => r.serverTiming[key] ?? "-";
  const lines = [
    `# Speed evidence: ${args.label}`,
    "",
    `- App: ${args.url}`,
    `- File: ${basename(args.file)} (5,000 rows)`,
    `- Insert mode: ${args.insertMode ?? "batch (default)"}`,
    `- Started: ${startedAt}`,
    `- Idle wait before run 1: ${args.waitIdleSeconds} s`,
    `- Measured from: ${process.env.BENCH_LOCATION ?? "developer laptop"} (client times include the network round trip)`,
    "",
    "## Waits per run (ms)",
    "",
    "| Run | Kind | Review wait (upload + page) | Upload | Review page | Save | Export | Totals correct |",
    "|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.run} | ${r.kind} | ${r.reviewWaitMs} | ${r.uploadMs} | ${r.reviewPageMs} | ${r.saveMs} | ${r.exportMs} | ${r.totalsCorrect ? "yes" : "NO"} |`),
    "",
    "## Where the upload time goes (Server-Timing, ms)",
    "",
    "| Run | Parse | Rules | Database (all) | of which source rows | of which lines | Server total |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.run} | ${st(r, "parseMs")} | ${st(r, "rulesMs")} | ${st(r, "dbMs")} | ${st(r, "sourceRowsMs")} | ${st(r, "linesMs")} | ${st(r, "total")} |`),
    "",
  ];
  if (repeats.length > 0) {
    lines.push(
      "## Median of repeat runs (ms)",
      "",
      `Review wait ${median(repeats.map((r) => r.reviewWaitMs))} · Save ${median(repeats.map((r) => r.saveMs))} · Export ${median(repeats.map((r) => r.exportMs))}`,
      "",
    );
  }
  lines.push(
    "## Totals check (every run)",
    "",
    `Expected ${EXPECTED.lines} lines, ${EXPECTED.pieces} pieces, $${EXPECTED.supplierValue}.`,
    "",
    ...results.map((r) => `- Run ${r.run}: screen ${r.pieces} pcs / $${r.supplierValue}; CSV ${r.csvLines} lines / ${r.csvPieces} pcs / $${r.csvSupplierValue}; export ${r.exportBytes} bytes; offer ${r.offerId}`),
    "",
  );
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  const file = readFileSync(args.file);

  if (args.waitIdleSeconds > 0) {
    console.log(`Waiting ${args.waitIdleSeconds} s with no traffic so the function and database go idle...`);
    await new Promise((resolve) => setTimeout(resolve, args.waitIdleSeconds * 1000));
  }

  const startedAt = new Date().toISOString();
  const results: RunResult[] = [];
  for (let run = 1; run <= args.runs; run++) {
    const result = await runOnce(args, file, run);
    results.push(result);
    console.log(
      `run ${run} (${result.kind}): review ${result.reviewWaitMs} ms, save ${result.saveMs} ms, export ${result.exportMs} ms, db ${result.serverTiming.dbMs ?? "-"} ms, totals ${result.totalsCorrect ? "ok" : "WRONG"}`,
    );
  }

  const markdown = toMarkdown(args, results, startedAt);
  mkdirSync("docs/evidence", { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const base = `docs/evidence/speed-${args.label}-${stamp}`;
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.json`, JSON.stringify({ args, startedAt, results }, null, 2));
  console.log(`\n${markdown}\nSaved ${base}.md and ${base}.json`);

  if (results.some((r) => !r.totalsCorrect)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
