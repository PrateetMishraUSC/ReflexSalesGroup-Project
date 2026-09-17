// Imports an uploaded sheet: parse, apply rules, then store offer, source rows and lines in one retry-safe transaction.
import { desc, eq } from "drizzle-orm";
import { lineEvents, lines, offers, sourceRows } from "@/db/schema";
import { findStoredResponse, hashRequest, withIdempotency, type Tx } from "@/lib/db/idempotency";
import { toLineRow, toSourceRow, type LineInsert, type SourceRowInsert } from "@/lib/db/rows";
import { SimulatedFailureError } from "@/lib/errors";
import { parseUpload } from "@/lib/parse";
import type { LayoutId } from "@/lib/parse/layouts";
import { reviewOffer } from "@/lib/rules";
import type { OfferTotals } from "@/lib/rules/offer";

export type InsertMode = "batch" | "row";

export const INSERT_BATCH_SIZE = 1000;

export type ImportOptions = {
  file: Buffer;
  filename: string;
  idempotencyKey: string;
  insertMode?: InsertMode;
  simulateFailure?: "before-commit" | "after-commit";
};

export type ImportResponse = {
  offerId: string;
  name: string;
  layout: LayoutId;
  totals: OfferTotals;
  earlierUploads: { id: string; name: string; createdAt: string }[];
};

export type ImportResult = {
  response: ImportResponse;
  replayed: boolean;
  timings: { parseMs: number; rulesMs: number; dbMs: number };
};

async function insertInChunks<T extends LineInsert | SourceRowInsert>(
  rows: T[],
  mode: InsertMode,
  insert: (chunk: T[]) => Promise<unknown>,
) {
  const size = mode === "batch" ? INSERT_BATCH_SIZE : 1;
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

const elapsed = (start: number) => Math.round(performance.now() - start);

export async function importOffer(options: ImportOptions): Promise<ImportResult> {
  const { file, filename, idempotencyKey, insertMode = "batch", simulateFailure } = options;
  const fileHash = hashRequest(file);

  const stored = await findStoredResponse<ImportResponse>(idempotencyKey, fileHash);
  if (stored) return { response: stored, replayed: true, timings: { parseMs: 0, rulesMs: 0, dbMs: 0 } };

  let start = performance.now();
  const extracted = parseUpload(file);
  const parseMs = elapsed(start);

  start = performance.now();
  const reviewed = reviewOffer(extracted);
  const rulesMs = elapsed(start);

  start = performance.now();
  const { result, replayed } = await withIdempotency<ImportResponse>(idempotencyKey, fileHash, async (tx: Tx) => {
    const earlier = await tx
      .select({ id: offers.id, name: offers.name, createdAt: offers.createdAt })
      .from(offers)
      .where(eq(offers.sourceSha256, fileHash))
      .orderBy(desc(offers.createdAt));

    const [offer] = await tx
      .insert(offers)
      .values({
        name: extracted.title ?? filename,
        layout: extracted.layout,
        sourceFilename: filename,
        sourceSha256: fileHash,
        sheetName: extracted.sheetName,
        headerRow: extracted.headerRow,
        headers: extracted.headers,
      })
      .returning({ id: offers.id, name: offers.name, layout: offers.layout });

    await insertInChunks(
      extracted.sourceRows.map((row) => toSourceRow(offer.id, row)),
      insertMode,
      (chunk) => tx.insert(sourceRows).values(chunk),
    );
    await insertInChunks(
      reviewed.lines.map((line, i) => toLineRow(offer.id, line, extracted.lines[i].raw)),
      insertMode,
      (chunk) => tx.insert(lines).values(chunk),
    );
    await tx.insert(lineEvents).values({
      offerId: offer.id,
      action: "import",
      after: { filename, lines: reviewed.lines.length, totals: reviewed.totals },
      offerVersion: 1,
    });

    if (simulateFailure === "before-commit") throw new SimulatedFailureError("before-commit");

    return {
      offerId: offer.id,
      name: offer.name,
      layout: offer.layout,
      totals: reviewed.totals,
      earlierUploads: earlier.map((e) => ({ id: e.id, name: e.name, createdAt: e.createdAt.toISOString() })),
    };
  });
  const dbMs = elapsed(start);

  if (simulateFailure === "after-commit" && !replayed) throw new SimulatedFailureError("after-commit");

  return { response: result, replayed, timings: { parseMs, rulesMs, dbMs } };
}
