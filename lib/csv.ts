// Builds RFC 4180 CSV text with a UTF-8 BOM, quoting where needed and neutralising spreadsheet formulas in text cells.
export type CsvCell = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell, isText: boolean): string {
  if (value === null) return "";
  let text = String(value);
  if (isText && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][], textColumns: ReadonlySet<number>): string {
  const lines = [header.map((h) => csvCell(h, true)), ...rows.map((row) => row.map((cell, i) => csvCell(cell, textColumns.has(i))))];
  return `\uFEFF${lines.map((cells) => cells.join(",")).join("\r\n")}\r\n`;
}
