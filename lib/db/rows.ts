// Converts between rule results, database rows and API line views (money as exact decimal strings).
import { lines, sourceRows } from "@/db/schema";
import type { CandidateLine, SourceRow } from "@/lib/parse/extract";
import { centsToDecimal, decimalToUnits, unitsToDecimal } from "@/lib/rules/money";
import type { EvaluatedLine, ReviewLine } from "@/lib/rules/offer";

export type LineInsert = typeof lines.$inferInsert;
export type LineRow = typeof lines.$inferSelect;
export type SourceRowInsert = typeof sourceRows.$inferInsert;

const units = (value: number | null) => (value === null ? null : unitsToDecimal(value));
const cents = (value: number | null) => (value === null ? null : centsToDecimal(value));
const toUnits = (value: string | null) => (value === null ? null : decimalToUnits(value)!);

export function evaluatedColumns(line: EvaluatedLine) {
  return {
    itemCode: line.itemCode,
    size: line.size,
    quantity: line.quantity,
    unitCost: units(line.unitCost),
    lineValue: cents(line.lineValue),
    retailValue: cents(line.retailValue),
    status: line.status,
    decision: line.decision,
    excludeReason: line.excludeReason,
    issues: line.issues,
  };
}

export function toLineRow(offerId: string, line: EvaluatedLine, raw: CandidateLine["raw"]): LineInsert {
  return {
    ...evaluatedColumns(line),
    offerId,
    sheetRow: line.sheetRow,
    sourceCol: line.sourceCol,
    description: line.description,
    category: line.category,
    retailPrice: units(line.retailPrice),
    supplierTotal: line.supplierTotal,
    supplierTotalCell: line.supplierTotalCell,
    raw,
  };
}

export function toSourceRow(offerId: string, row: SourceRow): SourceRowInsert {
  return { offerId, sheetRow: row.sheetRow, cells: row.cells };
}

export function fromLineRow(row: Omit<LineRow, "raw">): ReviewLine {
  return {
    sheetRow: row.sheetRow,
    sourceCol: row.sourceCol,
    itemCode: row.itemCode,
    description: row.description,
    size: row.size,
    category: row.category,
    quantity: row.quantity,
    unitCost: toUnits(row.unitCost),
    retailPrice: toUnits(row.retailPrice),
    supplierTotal: row.supplierTotal,
    supplierTotalCell: row.supplierTotalCell,
    issues: row.issues,
    decision: row.decision,
  };
}

export function toLineView(row: LineRow) {
  return {
    id: row.id,
    sheetRow: row.sheetRow,
    sourceCol: row.sourceCol,
    itemCode: row.itemCode,
    description: row.description,
    size: row.size,
    category: row.category,
    quantity: row.quantity,
    unitCost: units(toUnits(row.unitCost)),
    retailPrice: units(toUnits(row.retailPrice)),
    lineValue: row.lineValue,
    retailValue: row.retailValue,
    supplierTotal: row.supplierTotal,
    status: row.status,
    decision: row.decision,
    excludeReason: row.excludeReason,
    issues: row.issues,
    raw: row.raw,
    edits: row.edits,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type LineView = ReturnType<typeof toLineView>;
