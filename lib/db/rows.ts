// Converts evaluated lines and source rows into database rows (money as exact decimal strings).
import { lines, sourceRows } from "@/db/schema";
import type { CandidateLine, SourceRow } from "@/lib/parse/extract";
import { centsToDecimal, unitsToDecimal } from "@/lib/rules/money";
import type { EvaluatedLine } from "@/lib/rules/offer";

export type LineInsert = typeof lines.$inferInsert;
export type SourceRowInsert = typeof sourceRows.$inferInsert;

const units = (value: number | null) => (value === null ? null : unitsToDecimal(value));
const cents = (value: number | null) => (value === null ? null : centsToDecimal(value));

export function toLineRow(offerId: string, line: EvaluatedLine, raw: CandidateLine["raw"]): LineInsert {
  return {
    offerId,
    sheetRow: line.sheetRow,
    sourceCol: line.sourceCol,
    itemCode: line.itemCode,
    description: line.description,
    size: line.size,
    category: line.category,
    quantity: line.quantity,
    unitCost: units(line.unitCost),
    retailPrice: units(line.retailPrice),
    lineValue: cents(line.lineValue),
    retailValue: cents(line.retailValue),
    supplierTotal: line.supplierTotal,
    supplierTotalCell: line.supplierTotalCell,
    status: line.status,
    decision: line.decision,
    excludeReason: line.excludeReason,
    issues: line.issues,
    raw,
  };
}

export function toSourceRow(offerId: string, row: SourceRow): SourceRowInsert {
  return { offerId, sheetRow: row.sheetRow, cells: row.cells };
}
