// Field rules: turn one raw cell into a clean value or an issue explaining what is wrong.
import type { LineField, RawField } from "@/lib/parse/extract";
import { MAX_QUANTITY, MAX_UNIT_COST_DOLLARS, MAX_COST_DECIMALS } from "./config";
import { ISSUE_SEVERITY, type Issue, type IssueCode } from "./issues";
import { decimalPlaces, decimalToUnits, isPlainDecimal, numberToDecimal, UNITS_PER_DOLLAR, type CostUnits } from "./money";

export type FieldResult<T> = { value: T | null; issues: Issue[] };

const LABELS: Record<LineField, string> = {
  itemCode: "Item code",
  description: "Description",
  size: "Size",
  quantity: "Quantity",
  unitCost: "Unit cost",
  retailPrice: "Retail price",
  category: "Category",
};

function shown(raw: RawField | null): string | null {
  if (!raw || raw.v === null) return null;
  return typeof raw.v === "string" ? raw.v : String(raw.v);
}

function where(field: LineField, raw: RawField | null): string {
  return raw?.ref ? `${LABELS[field]} in ${raw.ref}` : LABELS[field];
}

function issue(code: IssueCode, field: LineField, raw: RawField | null, message: string): Issue {
  return { code, severity: ISSUE_SEVERITY[code], field, cell: raw?.ref || null, raw: shown(raw), message };
}

const isEmpty = (raw: RawField | null) => !raw || raw.v === null || (typeof raw.v === "string" && raw.v.trim() === "");

export function parseItemCode(raw: RawField | null): FieldResult<string> {
  if (isEmpty(raw)) return { value: null, issues: [issue("CODE_MISSING", "itemCode", raw, `${where("itemCode", raw)} is missing.`)] };
  const v = raw!.v;

  if (typeof v === "number") {
    if (raw!.z && /^0+$/.test(raw!.z) && Number.isInteger(v) && v >= 0) {
      const padded = String(v).padStart(raw!.z.length, "0");
      const issues = padded === String(v) ? [] : [issue("CODE_ZERO_PADDED", "itemCode", raw, `${where("itemCode", raw)} was stored as the number ${v}; kept the leading zeros shown in Excel: ${padded}.`)];
      return { value: padded, issues };
    }
    return { value: String(v), issues: [] };
  }
  if (typeof v !== "string") {
    return { value: null, issues: [issue("CODE_INVALID", "itemCode", raw, `${where("itemCode", raw)} is not a valid code.`)] };
  }

  const trimmed = v.trim();
  const issues = trimmed === v ? [] : [issue("CODE_TRIMMED", "itemCode", raw, `${where("itemCode", raw)} had extra spaces, read as "${trimmed}".`)];
  return { value: trimmed, issues };
}

export function parseText(raw: RawField | null): string | null {
  if (isEmpty(raw)) return null;
  return String(raw!.v).trim();
}

export function parseSize(raw: RawField | null): FieldResult<string> {
  const value = parseText(raw);
  if (value === null) return { value: null, issues: [issue("SIZE_MISSING", "size", raw, `${where("size", raw)} is missing.`)] };
  return { value, issues: [] };
}

export function parseDescription(raw: RawField | null): FieldResult<string> {
  const value = parseText(raw);
  if (value === null) {
    return { value: null, issues: [issue("DESCRIPTION_MISSING", "description", raw, `${where("description", raw)} is missing.`)] };
  }
  return { value, issues: [] };
}

export function parseQuantity(raw: RawField | null): FieldResult<number> {
  const field = "quantity";
  if (isEmpty(raw)) return { value: null, issues: [issue("QTY_MISSING", field, raw, `${where(field, raw)} is missing.`)] };
  const v = raw!.v;
  const notes: Issue[] = [];
  let text: string | null;

  if (typeof v === "number") {
    text = numberToDecimal(v);
  } else if (typeof v === "string") {
    const cleaned = v.trim().replace(/^(-?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/, (_, sign, whole, fraction = "") => `${sign}${whole.replace(/,/g, "")}${fraction}`);
    text = isPlainDecimal(cleaned) ? cleaned : null;
    if (text !== null) notes.push(issue("QTY_FROM_TEXT", field, raw, `${where(field, raw)} was text "${v}", read as ${Number(text)}.`));
  } else {
    text = null;
  }

  if (text === null) {
    return { value: null, issues: [issue("QTY_NOT_NUMBER", field, raw, `${where(field, raw)} is "${shown(raw)}", which is not a number of pieces.`)] };
  }
  const quantity = Number(text);
  if (!Number.isInteger(quantity)) {
    return { value: null, issues: [issue("QTY_NOT_WHOLE", field, raw, `${where(field, raw)} is ${text}; pieces must be a whole number.`)] };
  }
  if (quantity < 0) {
    return { value: null, issues: [issue("QTY_NEGATIVE", field, raw, `${where(field, raw)} is ${quantity}; available pieces cannot be negative.`)] };
  }
  if (quantity > MAX_QUANTITY) {
    return { value: null, issues: [issue("QTY_TOO_LARGE", field, raw, `${where(field, raw)} is ${quantity.toLocaleString("en-US")}, above the limit of ${MAX_QUANTITY.toLocaleString("en-US")} pieces.`)] };
  }
  return { value: quantity, issues: notes };
}

function moneyText(raw: RawField): { text: string | null; fromText: boolean } {
  const v = raw.v;
  if (typeof v === "number") return { text: numberToDecimal(v), fromText: false };
  if (typeof v !== "string") return { text: null, fromText: false };
  const cleaned = v
    .trim()
    .replace(/^(-?)\s*(?:US)?\$\s*/i, "$1")
    .replace(/\s*USD$/i, "")
    .replace(/^(-?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/, (_, sign, whole, fraction = "") => `${sign}${whole.replace(/,/g, "")}${fraction}`);
  return { text: isPlainDecimal(cleaned) ? cleaned : null, fromText: true };
}

export function parseUnitCost(raw: RawField | null): FieldResult<CostUnits> {
  const field = "unitCost";
  if (isEmpty(raw)) return { value: null, issues: [issue("COST_MISSING", field, raw, `${where(field, raw)} is missing.`)] };
  const { text, fromText } = moneyText(raw!);

  if (text === null) {
    return { value: null, issues: [issue("COST_NOT_NUMBER", field, raw, `${where(field, raw)} is "${shown(raw)}", which is not a USD amount.`)] };
  }
  if (decimalPlaces(text) > MAX_COST_DECIMALS) {
    return { value: null, issues: [issue("COST_TOO_PRECISE", field, raw, `${where(field, raw)} is ${text}; use at most ${MAX_COST_DECIMALS} decimal places.`)] };
  }
  const units = decimalToUnits(text);
  if (units === null || units > MAX_UNIT_COST_DOLLARS * UNITS_PER_DOLLAR) {
    return { value: null, issues: [issue("COST_TOO_LARGE", field, raw, `${where(field, raw)} is ${text}, above the limit of $${MAX_UNIT_COST_DOLLARS.toLocaleString("en-US")} per piece.`)] };
  }
  if (units <= 0) {
    return { value: null, issues: [issue("COST_NOT_POSITIVE", field, raw, `${where(field, raw)} is ${text}; the cost per piece must be more than $0.`)] };
  }
  const issues = fromText ? [issue("COST_FROM_TEXT", field, raw, `${where(field, raw)} was text "${shown(raw)}", read as $${text}.`)] : [];
  return { value: units, issues };
}

export function parseRetailPrice(raw: RawField | null): FieldResult<CostUnits> {
  const field = "retailPrice";
  if (isEmpty(raw)) return { value: null, issues: [] };
  const { text, fromText } = moneyText(raw!);
  const units = text !== null && decimalPlaces(text) <= MAX_COST_DECIMALS ? decimalToUnits(text) : null;

  if (units === null || units < 0) {
    return { value: null, issues: [issue("RETAIL_INVALID", field, raw, `${where(field, raw)} is "${shown(raw)}", which is not a valid reference price; it will be ignored.`)] };
  }
  const issues = fromText ? [issue("RETAIL_FROM_TEXT", field, raw, `${where(field, raw)} was text "${shown(raw)}", read as $${text}.`)] : [];
  return { value: units, issues };
}

export function parseSupplierTotal(raw: RawField | null): number | null {
  if (isEmpty(raw) || typeof raw!.v !== "number" || !Number.isInteger(raw!.v)) return null;
  return raw!.v;
}
