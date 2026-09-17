// Test helpers: load supplied fixtures and build small workbooks for edge cases.
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

export const fixture = (name: string) => readFileSync(`fixtures/${name}`);

export function makeWorkbook(
  sheets: Record<string, (string | number | null)[][]>,
  bookType: XLSX.BookType = "xlsx",
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}
