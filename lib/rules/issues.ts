// Issue codes, their severity, and the shape of an issue attached to a line.
import type { LineField } from "@/lib/parse/extract";

export type Severity = "error" | "warning" | "info";

export const ISSUE_SEVERITY = {
  CODE_MISSING: "error",
  CODE_INVALID: "error",
  CODE_ZERO_PADDED: "info",
  CODE_TRIMMED: "info",
  SIZE_MISSING: "error",
  DESCRIPTION_MISSING: "warning",
  QTY_MISSING: "error",
  QTY_NOT_NUMBER: "error",
  QTY_NOT_WHOLE: "error",
  QTY_NEGATIVE: "error",
  QTY_TOO_LARGE: "error",
  QTY_FROM_TEXT: "info",
  COST_MISSING: "error",
  COST_NOT_NUMBER: "error",
  COST_NOT_POSITIVE: "error",
  COST_TOO_LARGE: "error",
  COST_TOO_PRECISE: "error",
  COST_FROM_TEXT: "info",
  RETAIL_INVALID: "warning",
  RETAIL_FROM_TEXT: "info",
  QTY_ZERO: "info",
  DUPLICATE_EXACT: "info",
  DUPLICATE_CONFLICT: "error",
  DUPLICATE_KEPT_BOTH: "warning",
  SUPPLIER_TOTAL_MISSING: "warning",
  SUPPLIER_TOTAL_MISMATCH: "warning",
  COST_ABOVE_RETAIL: "warning",
} as const satisfies Record<string, Severity>;

export type IssueCode = keyof typeof ISSUE_SEVERITY;

export const OFFER_ISSUE_CODES: ReadonlySet<IssueCode> = new Set([
  "QTY_ZERO",
  "DUPLICATE_EXACT",
  "DUPLICATE_CONFLICT",
  "DUPLICATE_KEPT_BOTH",
  "SUPPLIER_TOTAL_MISSING",
  "SUPPLIER_TOTAL_MISMATCH",
  "COST_ABOVE_RETAIL",
]);

export type Issue = {
  code: IssueCode;
  severity: Severity;
  field: LineField | "line";
  cell: string | null;
  raw: string | null;
  message: string;
};

export const hasErrors = (issues: Issue[]) => issues.some((issue) => issue.severity === "error");
