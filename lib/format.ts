// Display formatting for money, counts and layouts, done on decimal strings so amounts are never rounded by floats.
export function formatUsd(decimal: string | null): string {
  if (decimal === null) return "—";
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = decimal.replace(/^-/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction.padEnd(2, "0")}`;
}

export function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

export const LAYOUT_LABELS = {
  northstar: "Northstar",
  harbor: "Harbor",
} as const;

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
