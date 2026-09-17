// Shared write path for offer changes: retry-safe transaction, version check, reload and re-evaluate lines, write only what changed.
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { lines, offers } from "@/db/schema";
import { findStoredResponse, withIdempotency, type IdempotentResult, type Tx } from "@/lib/db/idempotency";
import { evaluatedColumns, fromLineRow, toLineView, type LineRow, type LineView } from "@/lib/db/rows";
import { NotFoundError, SimulatedFailureError, VersionConflictError } from "@/lib/errors";
import { evaluateOffer, type EvaluatedLine, type ReviewLine } from "@/lib/rules/offer";

export type FailurePoint = "before-commit" | "after-commit";

export type ChangeOptions = { idempotencyKey: string; requestHash: string; simulateFailure?: FailurePoint };

export async function runOfferChange<T extends object>(
  options: ChangeOptions,
  work: (tx: Tx) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const stored = await findStoredResponse<T>(options.idempotencyKey, options.requestHash);
  if (stored) return { result: stored, replayed: true };

  const outcome = await withIdempotency<T>(options.idempotencyKey, options.requestHash, async (tx) => {
    const result = await work(tx);
    if (options.simulateFailure === "before-commit") throw new SimulatedFailureError("before-commit");
    return result;
  });
  if (options.simulateFailure === "after-commit" && !outcome.replayed) throw new SimulatedFailureError("after-commit");
  return outcome;
}

export async function bumpVersion(tx: Tx, offerId: string, expectedVersion: number, reopen: boolean): Promise<number> {
  const [row] = await tx
    .update(offers)
    .set({ version: sql`${offers.version} + 1`, updatedAt: sql`now()`, ...(reopen ? { status: "in_review" as const } : {}) })
    .where(and(eq(offers.id, offerId), eq(offers.version, expectedVersion)))
    .returning({ version: offers.version });
  if (row) return row.version;

  const [current] = await tx.select({ version: offers.version }).from(offers).where(eq(offers.id, offerId));
  if (!current) throw new NotFoundError();
  throw new VersionConflictError(current.version);
}

export type LoadedLine = { row: Omit<LineRow, "raw">; review: ReviewLine; before: string };

const { raw, ...reviewColumns } = getTableColumns(lines);
void raw;

const signature = (line: ReviewLine & { status: string; excludeReason: string | null }) =>
  JSON.stringify([
    line.status,
    line.excludeReason,
    line.decision,
    line.issues.map((i) => [i.code, i.severity, i.field, i.cell, i.raw, i.message]),
    line.quantity,
    line.unitCost,
    line.itemCode,
    line.size,
  ]);

export async function loadLines(tx: Tx, offerId: string): Promise<LoadedLine[]> {
  const rows = await tx
    .select(reviewColumns)
    .from(lines)
    .where(eq(lines.offerId, offerId))
    .orderBy(asc(lines.sheetRow), asc(lines.sourceCol));
  return rows.map((row) => {
    const review = fromLineRow(row);
    return { row, review, before: signature({ ...review, status: row.status, excludeReason: row.excludeReason }) };
  });
}

export async function reevaluateAndWrite(
  tx: Tx,
  loaded: LoadedLine[],
  extraUpdates: Map<string, Partial<Pick<LineRow, "edits">>> = new Map(),
): Promise<{ evaluated: EvaluatedLine[]; changed: LineView[] }> {
  const { lines: evaluated } = evaluateOffer(loaded.map((line) => line.review));
  const changed: LineView[] = [];

  for (let i = 0; i < loaded.length; i++) {
    const id = loaded[i].row.id;
    const extra = extraUpdates.get(id);
    if (!extra && signature(evaluated[i]) === loaded[i].before) continue;
    const [updated] = await tx
      .update(lines)
      .set({ ...evaluatedColumns(evaluated[i]), ...extra, updatedAt: sql`now()` })
      .where(eq(lines.id, id))
      .returning();
    changed.push(toLineView(updated));
  }
  return { evaluated, changed };
}
