// Reviewer actions on lines: correct a value, include or leave out one line, or leave out every questionable line.
import { lineEvents } from "@/db/schema";
import { hashRequest } from "@/lib/db/idempotency";
import type { LineView } from "@/lib/db/rows";
import { DecisionNotAllowedError, InvalidEditError, NotFoundError } from "@/lib/errors";
import { parseItemCode, parseQuantity, parseSize, parseUnitCost, type FieldResult } from "@/lib/rules/fields";
import { OFFER_ISSUE_CODES, type Issue } from "@/lib/rules/issues";
import type { Decision, OfferTotals } from "@/lib/rules/offer";
import { unitsToDecimal } from "@/lib/rules/money";
import { bumpVersion, loadLines, reevaluateAndWrite, runOfferChange, type FailurePoint } from "./offer-change";
import { getTotals } from "./read-offer";

export type EditableField = "itemCode" | "size" | "quantity" | "unitCost";

export type LineChange = {
  expectedVersion: number;
  changes?: Partial<Record<EditableField, string | number | null>>;
  decision?: Decision | null;
};

export type EditResponse = {
  offerId: string;
  offerVersion: number;
  line: LineView;
  changedLines: LineView[];
  totals: OfferTotals;
};

export type BulkResponse = { offerId: string; offerVersion: number; excludedCount: number; totals: OfferTotals };

type Parser = (raw: { ref: string; v: string | number | null }) => FieldResult<number | string>;

const PARSERS: Record<EditableField, Parser> = {
  itemCode: parseItemCode,
  size: parseSize,
  quantity: parseQuantity,
  unitCost: parseUnitCost,
};

const snapshot = (line: { status: string; decision: Decision | null; quantity: number | null; unitCost: number | null; itemCode: string | null; size: string | null }) => ({
  status: line.status,
  decision: line.decision,
  itemCode: line.itemCode,
  size: line.size,
  quantity: line.quantity,
  unitCost: line.unitCost === null ? null : unitsToDecimal(line.unitCost),
});

export async function editLine(
  offerId: string,
  lineId: string,
  change: LineChange,
  options: { idempotencyKey: string; simulateFailure?: FailurePoint },
) {
  const requestHash = hashRequest("PATCH line", offerId, lineId, JSON.stringify(change));

  return runOfferChange<EditResponse>({ ...options, requestHash }, async (tx) => {
    const offerVersion = await bumpVersion(tx, offerId, change.expectedVersion, true);
    const loaded = await loadLines(tx, offerId);
    const target = loaded.find((line) => line.row.id === lineId);
    if (!target) throw new NotFoundError("Line");

    const review = target.review;
    const before = snapshot({ ...review, status: target.row.status });
    const invalid: Issue[] = [];

    for (const [field, value] of Object.entries(change.changes ?? {}) as [EditableField, string | number | null][]) {
      const result = PARSERS[field]({ ref: "", v: value });
      invalid.push(...result.issues.filter((issue) => issue.severity === "error"));
      Object.assign(review, { [field]: result.value });
      review.issues = [...review.issues.filter((issue) => issue.field !== field || OFFER_ISSUE_CODES.has(issue.code)), ...result.issues];
    }
    if (invalid.length > 0) throw new InvalidEditError(invalid);

    if (change.decision !== undefined) {
      if (change.decision === "include") {
        const blocking = review.issues.filter((issue) => issue.severity === "error" && !OFFER_ISSUE_CODES.has(issue.code));
        if (blocking.length > 0) {
          throw new DecisionNotAllowedError(`Correct this line before including it: ${blocking.map((issue) => issue.message).join(" ")}`);
        }
        if (review.quantity === 0) throw new DecisionNotAllowedError("This line has no units available, so it cannot be included.");
      }
      review.decision = change.decision;
    }

    const edits = change.changes ? { ...target.row.edits, ...change.changes } : target.row.edits;
    const { changed } = await reevaluateAndWrite(tx, loaded, new Map([[lineId, { edits }]]));
    const line = changed.find((view) => view.id === lineId)!;

    await tx.insert(lineEvents).values({
      offerId,
      lineId,
      action: change.changes ? "edit" : "decision",
      before,
      after: {
        status: line.status,
        decision: line.decision,
        itemCode: line.itemCode,
        size: line.size,
        quantity: line.quantity,
        unitCost: line.unitCost,
        request: change,
      },
      offerVersion,
    });

    return { offerId, offerVersion, line, changedLines: changed, totals: await getTotals(offerId, tx) };
  });
}

export async function excludeNeedsReview(
  offerId: string,
  expectedVersion: number,
  options: { idempotencyKey: string; simulateFailure?: FailurePoint },
) {
  const requestHash = hashRequest("POST bulk exclude_needs_review", offerId, String(expectedVersion));

  return runOfferChange<BulkResponse>({ ...options, requestHash }, async (tx) => {
    const offerVersion = await bumpVersion(tx, offerId, expectedVersion, true);
    const loaded = await loadLines(tx, offerId);
    const targets = loaded.filter((line) => line.row.status === "needs_review");
    for (const line of targets) line.review.decision = "exclude";

    await reevaluateAndWrite(tx, loaded);
    await tx.insert(lineEvents).values({
      offerId,
      action: "bulk_exclude_needs_review",
      after: { lineIds: targets.map((line) => line.row.id), count: targets.length },
      offerVersion,
    });

    return { offerId, offerVersion, excludedCount: targets.length, totals: await getTotals(offerId, tx) };
  });
}
