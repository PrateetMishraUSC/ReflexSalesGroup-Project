// Applies every field rule to a candidate line and collects the clean values and issues.
import type { CandidateLine } from "@/lib/parse/extract";
import {
  parseDescription,
  parseItemCode,
  parseQuantity,
  parseRetailPrice,
  parseSize,
  parseSupplierTotal,
  parseText,
  parseUnitCost,
} from "./fields";
import type { Issue } from "./issues";
import type { CostUnits } from "./money";

export type CleanLine = {
  sheetRow: number;
  sourceCol: string;
  itemCode: string | null;
  description: string | null;
  size: string | null;
  category: string | null;
  quantity: number | null;
  unitCost: CostUnits | null;
  retailPrice: CostUnits | null;
  supplierTotal: number | null;
  supplierTotalCell: string | null;
  issues: Issue[];
};

export function cleanLine(line: CandidateLine): CleanLine {
  const { raw } = line;
  const itemCode = parseItemCode(raw.itemCode);
  const description = parseDescription(raw.description);
  const size = parseSize(raw.size);
  const quantity = parseQuantity(raw.quantity);
  const unitCost = parseUnitCost(raw.unitCost);
  const retailPrice = parseRetailPrice(raw.retailPrice);

  return {
    sheetRow: line.sheetRow,
    sourceCol: line.sourceCol,
    itemCode: itemCode.value,
    description: description.value,
    size: size.value,
    category: parseText(raw.category),
    quantity: quantity.value,
    unitCost: unitCost.value,
    retailPrice: retailPrice.value,
    supplierTotal: parseSupplierTotal(raw.supplierTotal),
    supplierTotalCell: raw.supplierTotal?.ref ?? null,
    issues: [
      ...itemCode.issues,
      ...description.issues,
      ...size.issues,
      ...quantity.issues,
      ...unitCost.issues,
      ...retailPrice.issues,
    ],
  };
}
