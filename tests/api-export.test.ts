// Tests that the CSV export is clean, safe to open in Excel, and adds up to exactly the totals shown on screen.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as exportCsv } from "@/app/api/offers/[id]/export.csv/route";
import { PATCH as patchLine } from "@/app/api/offers/[id]/lines/[lineId]/route";
import { GET as getOffer } from "@/app/api/offers/[id]/route";
import { POST as uploadOffer } from "@/app/api/offers/route";
import { csvCell, toCsv } from "@/lib/csv";
import { pool } from "@/lib/db/client";
import { CSV_HEADER, exportFilename } from "@/lib/offers/export-offer";
import { decimalToUnits } from "@/lib/rules/money";
import { resetDb } from "./helpers/db";
import { fixture, makeWorkbook } from "./helpers/xlsx";

const BASE = "http://localhost:3000";

async function createOffer(file: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(fixture(file))], file));
  const response = await uploadOffer(new Request(`${BASE}/api/offers`, { method: "POST", body: form, headers: { "Idempotency-Key": randomUUID() } }));
  return (await response.json()).offerId as string;
}

async function screen(offerId: string) {
  const response = await getOffer(new NextRequest(`${BASE}/api/offers/${offerId}?pageSize=500`), { params: Promise.resolve({ id: offerId }) });
  return response.json();
}

async function download(offerId: string) {
  const response = await exportCsv(new Request(`${BASE}/x`), { params: Promise.resolve({ id: offerId }) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes, text: bytes.toString("utf8").replace(/^\uFEFF/, "") };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

function sumCsv(rows: string[][]) {
  let pieces = 0;
  let cents = 0n;
  for (const row of rows.slice(1)) {
    pieces += Number(row[4]);
    cents += BigInt(decimalToUnits(row[6])! / 100);
  }
  const value = `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  return { lines: rows.length - 1, pieces, supplierValue: value };
}

beforeEach(resetDb);
afterAll(() => pool.end());

describe("GET /api/offers/:id/export.csv", () => {
  it("downloads the Northstar included lines as a clean CSV file", async () => {
    const offerId = await createOffer("01-northstar-line-sheet.xlsx");
    const { response, bytes, text } = await download(offerId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="northstar-supply-september-offer-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");

    expect(parseCsv(text)).toEqual([
      CSV_HEADER,
      ["000101", "Cotton crew tee", "One size", "Apparel", "120", "4.50", "540.00", "18.00", "6"],
      ["A102", "Canvas tote", "One size", "Accessories", "80", "3.25", "260.00", "15.00", "7"],
      ["A103", "Sport socks", "One size", "Apparel", "240", "1.80", "432.00", "8.00", "8"],
      ["A105", "Insulated bottle", "One size", "Home", "48", "6.50", "312.00", "24.00", "11"],
      ["A109", "Woven belt", "One size", "Accessories", "1200", "2.10", "2520.00", "12.00", "17"],
      ["A111", "Zip wallet", "One size", "Accessories", "45", "3.20", "144.00", "16.00", "19"],
    ]);
  });

  it.each([
    ["01-northstar-line-sheet.xlsx", { lines: 6, pieces: 1733, supplierValue: "4208.00" }],
    ["02-harbor-size-grid.xlsx", { lines: 22, pieces: 1340, supplierValue: "3740.00" }],
    ["03-northstar-5000-rows.xlsx", { lines: 5000, pieces: 62_444, supplierValue: "187214.50" }],
  ])("adds up to exactly the on-screen totals for %s", async (file, expected) => {
    const offerId = await createOffer(file);
    const { response, text } = await download(offerId);
    const fromCsv = sumCsv(parseCsv(text));
    const { totals } = await screen(offerId);

    expect(fromCsv).toEqual(expected);
    expect(fromCsv).toEqual({ lines: totals.includedLines, pieces: totals.pieces, supplierValue: totals.supplierValue });
    expect(response.headers.get("X-Offer-Pieces")).toBe(String(expected.pieces));
    expect(response.headers.get("X-Offer-Supplier-Value")).toBe(expected.supplierValue);
  });

  it("gives Harbor one row per size, with reference retail beside the supplier cost", async () => {
    const offerId = await createOffer("02-harbor-size-grid.xlsx");
    const rows = parseCsv((await download(offerId)).text);
    expect(rows[0][7]).toBe("Reference Retail per Piece (USD)");
    expect(rows.filter((r) => r[0] === "B204").map((r) => [r[2], r[4], r[5], r[7]])).toEqual([
      ["S", "20", "4.00", "20.00"],
      ["L", "30", "4.00", "20.00"],
    ]);
  });

  it("leaves reference retail out of the supplier cost totals", async () => {
    const offerId = await createOffer("01-northstar-line-sheet.xlsx");
    const { response, text } = await download(offerId);
    const rows = parseCsv(text).slice(1);
    const retailTotalCents = rows.reduce((sum, r) => sum + BigInt(decimalToUnits(r[7])! / 100) * BigInt(r[4]), 0n);
    expect(String(retailTotalCents)).toBe("2155200");
    expect(response.headers.get("X-Offer-Supplier-Value")).toBe("4208.00");
  });

  it("leaves the retail cell empty when the supplier gave none", async () => {
    const sheet = makeWorkbook({
      Offer: [
        ["Item Code", "Description", "Size", "Units Available", "Cost USD", "Retail USD"],
        ["Z1", "Lamp", "One size", 2, 3, null],
      ],
    });
    const form = new FormData();
    form.append("file", new File([new Uint8Array(sheet)], "no-retail.xlsx"));
    const upload = await uploadOffer(new Request(`${BASE}/api/offers`, { method: "POST", body: form, headers: { "Idempotency-Key": randomUUID() } }));
    const { offerId } = await upload.json();

    const [header, row] = parseCsv((await download(offerId)).text);
    expect(header).toHaveLength(9);
    expect(row).toEqual(["Z1", "Lamp", "One size", "", "2", "3.00", "6.00", "", "2"]);
  });

  it("reflects corrections and decisions, still matching the screen", async () => {
    const offerId = await createOffer("01-northstar-line-sheet.xlsx");
    const { lines } = await screen(offerId);
    const byRow = (row: number) => lines.find((l: { sheetRow: number }) => l.sheetRow === row).id;
    const edit = (lineId: string, body: object) =>
      patchLine(
        new Request(`${BASE}/x`, { method: "PATCH", body: JSON.stringify(body), headers: { "Idempotency-Key": randomUUID() } }),
        { params: Promise.resolve({ id: offerId, lineId }) },
      );
    await edit(byRow(9), { expectedVersion: 1, changes: { unitCost: 9 } });
    await edit(byRow(15), { expectedVersion: 2, decision: "exclude" });

    const { response, text } = await download(offerId);
    const fromCsv = sumCsv(parseCsv(text));
    const { totals } = await screen(offerId);
    expect(fromCsv).toEqual({ lines: 8, pieces: 1893, supplierValue: "5248.00" });
    expect(fromCsv.supplierValue).toBe(totals.supplierValue);
    expect(response.headers.get("X-Offer-Version")).toBe("3");
    expect(response.headers.get("X-Offer-Needs-Review")).toBe("3");
  });

  it("returns 404 for an unknown offer", async () => {
    const { response } = await download(randomUUID());
    expect(response.status).toBe(404);
  });
});

describe("CSV safety", () => {
  it.each([
    ["plain", "Tee", "Tee"],
    ["comma", "Tee, blue", '"Tee, blue"'],
    ["quote", 'The "best" tee', '"The ""best"" tee"'],
    ["new line", "Line 1\nLine 2", '"Line 1\nLine 2"'],
    ["formula", "=HYPERLINK(\"http://x\")", '"\'=HYPERLINK(""http://x"")"'],
    ["plus", "+1234", "'+1234"],
    ["minus", "-A1", "'-A1"],
    ["at sign", "@SUM(A1)", "'@SUM(A1)"],
  ])("escapes a text cell with %s", (_, input, expected) => {
    expect(csvCell(input, true)).toBe(expected);
  });

  it("does not alter numbers or empty cells", () => {
    expect(csvCell(120, false)).toBe("120");
    expect(csvCell("540.00", false)).toBe("540.00");
    expect(csvCell(null, true)).toBe("");
  });

  it("writes a BOM, a header and CRLF line endings", () => {
    expect(toCsv(["A", "B"], [["x", 1]], new Set([0]))).toBe("\uFEFFA,B\r\nx,1\r\n");
  });

  it("builds a safe, dated file name from the offer name", () => {
    expect(exportFilename("Harbor Apparel - September offer", new Date("2026-09-17T10:00:00Z"))).toBe("harbor-apparel-september-offer-2026-09-17.csv");
    expect(exportFilename("../../etc/passwd", new Date("2026-09-17T10:00:00Z"))).toBe("etc-passwd-2026-09-17.csv");
  });
});
