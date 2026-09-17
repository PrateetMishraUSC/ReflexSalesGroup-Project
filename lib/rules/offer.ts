// Offer rules: duplicates, zero stock, Harbor total checks, reviewer decisions, line status and totals.
import type { CleanLine } from "./clean-line";
import { hasErrors, ISSUE_SEVERITY, OFFER_ISSUE_CODES, type Issue, type IssueCode } from "./issues";
import { centsToDecimal, lineValueCents, unitsToDecimal, type Cents } from "./money";

export type LineStatus = "included" | "excluded" | "needs_review";

export type Decision = "include" | "exclude";

export type ReviewLine = CleanLine & { decision: Decision | null };

export type EvaluatedLine = ReviewLine & {
  status: LineStatus;
  excludeReason: string | null;
  lineValue: Cents | null;
  retailValue: Cents | null;
};

export type OfferTotals = {
  includedLines: number;
  excludedLines: number;
  needsReviewLines: number;
  pieces: number;
  supplierValue: string;
  retailValue: string;
};

export const EXCLUDE_REASONS = {
  reviewer: "Left out by reviewer",
  zero: "No units available",
  duplicate: (row: number) => `Duplicate of row ${row}`,
};

const offerIssue = (code: IssueCode, field: Issue["field"], cell: string | null, message: string): Issue => ({
  code,
  severity: ISSUE_SEVERITY[code],
  field,
  cell,
  raw: null,
  message,
});

const label = (line: CleanLine) => `${line.itemCode} (${line.size})`;

const rowName = (line: CleanLine) => (line.sourceCol ? `row ${line.sheetRow} ${line.size}` : `row ${line.sheetRow}`);

function findDuplicates(lines: ReviewLine[], extra: Issue[][], duplicateOf: Map<number, number>) {
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    if (line.decision === "exclude" || line.itemCode === null || line.size === null) return;
    const key = `${line.itemCode.toUpperCase()}|${line.size.toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const signature = (i: number) =>
      JSON.stringify([lines[i].quantity, lines[i].unitCost, lines[i].retailPrice, lines[i].description]);
    const identical = members.every((i) => signature(i) === signature(members[0]));
    const first = lines[members[0]];

    if (identical) {
      for (const i of members.slice(1)) {
        extra[i].push(offerIssue("DUPLICATE_EXACT", "line", null, `Same item, size, quantity and cost as row ${first.sheetRow}, so it is counted once.`));
        if (lines[i].decision !== "include") duplicateOf.set(i, first.sheetRow);
      }
      continue;
    }

    const keptBoth = members.every((i) => lines[i].decision === "include");
    for (const i of members) {
      const others = members.filter((j) => j !== i).map((j) => lines[j].sheetRow).join(", ");
      extra[i].push(
        keptBoth
          ? offerIssue("DUPLICATE_KEPT_BOTH", "line", null, `${label(lines[i])} is also listed in row ${others} with a different quantity or cost; the reviewer kept both.`)
          : offerIssue("DUPLICATE_CONFLICT", "line", null, `${label(lines[i])} is also listed in row ${others} with a different quantity or cost. Keep one, keep both, or leave them out.`),
      );
    }
  }
}

function checkSupplierTotals(lines: ReviewLine[], extra: Issue[][]) {
  const rows = new Map<number, number[]>();
  lines.forEach((line, index) => {
    if (line.supplierTotalCell === null) return;
    rows.set(line.sheetRow, [...(rows.get(line.sheetRow) ?? []), index]);
  });

  for (const members of rows.values()) {
    const first = lines[members[0]];
    const validSum = members.reduce((sum, i) => sum + (lines[i].quantity ?? 0), 0);
    const unreadable = members.filter((i) => lines[i].quantity === null).map((i) => lines[i].size);
    const note = unreadable.length ? ` (${unreadable.join(", ")} not counted)` : "";

    let issue: Issue | null = null;
    if (first.supplierTotal === null) {
      issue = offerIssue("SUPPLIER_TOTAL_MISSING", "quantity", first.supplierTotalCell, `Supplier's Total Units in ${first.supplierTotalCell} is blank; the readable sizes add up to ${validSum}${note}.`);
    } else if (first.supplierTotal !== validSum) {
      issue = offerIssue("SUPPLIER_TOTAL_MISMATCH", "quantity", first.supplierTotalCell, `Supplier's Total Units in ${first.supplierTotalCell} is ${first.supplierTotal}, but the readable sizes add up to ${validSum}${note}.`);
    }
    if (issue) for (const i of members) extra[i].push(issue);
  }
}

function lineChecks(line: ReviewLine): Issue[] {
  const issues: Issue[] = [];
  if (line.quantity === 0) {
    issues.push(offerIssue("QTY_ZERO", "quantity", null, `No units available for ${rowName(line)}, so it is left out.`));
  }
  if (line.unitCost !== null && line.retailPrice !== null && line.unitCost > line.retailPrice) {
    issues.push(offerIssue("COST_ABOVE_RETAIL", "unitCost", null, `Unit cost $${unitsToDecimal(line.unitCost)} is higher than the reference retail price $${unitsToDecimal(line.retailPrice)}.`));
  }
  return issues;
}

function decideStatus(line: ReviewLine, issues: Issue[], duplicateRow: number | undefined): Pick<EvaluatedLine, "status" | "excludeReason"> {
  if (line.decision === "exclude") return { status: "excluded", excludeReason: EXCLUDE_REASONS.reviewer };
  if (hasErrors(issues)) return { status: "needs_review", excludeReason: null };
  if (duplicateRow !== undefined) return { status: "excluded", excludeReason: EXCLUDE_REASONS.duplicate(duplicateRow) };
  if (line.quantity === 0) return { status: "excluded", excludeReason: EXCLUDE_REASONS.zero };
  return { status: "included", excludeReason: null };
}

export function evaluateOffer(input: ReviewLine[]): { lines: EvaluatedLine[]; totals: OfferTotals } {
  const lines = input.map((line) => ({ ...line, issues: line.issues.filter((i) => !OFFER_ISSUE_CODES.has(i.code)) }));
  const extra: Issue[][] = lines.map(lineChecks);
  const duplicateOf = new Map<number, number>();
  findDuplicates(lines, extra, duplicateOf);
  checkSupplierTotals(lines, extra);

  const evaluated = lines.map((line, index): EvaluatedLine => {
    const issues = [...line.issues, ...extra[index]];
    const priced = line.quantity !== null && line.unitCost !== null;
    return {
      ...line,
      issues,
      ...decideStatus(line, issues, duplicateOf.get(index)),
      lineValue: priced ? lineValueCents(line.quantity!, line.unitCost!) : null,
      retailValue: line.quantity !== null && line.retailPrice !== null ? lineValueCents(line.quantity, line.retailPrice) : null,
    };
  });

  return { lines: evaluated, totals: summarize(evaluated) };
}

export function summarize(lines: EvaluatedLine[]): OfferTotals {
  let pieces = 0;
  let supplier = 0n;
  let retail = 0n;
  const count = { included: 0, excluded: 0, needs_review: 0 };

  for (const line of lines) {
    count[line.status]++;
    if (line.status !== "included") continue;
    pieces += line.quantity!;
    supplier += BigInt(line.lineValue!);
    retail += BigInt(line.retailValue ?? 0);
  }

  return {
    includedLines: count.included,
    excludedLines: count.excluded,
    needsReviewLines: count.needs_review,
    pieces,
    supplierValue: centsToDecimal(supplier),
    retailValue: centsToDecimal(retail),
  };
}
