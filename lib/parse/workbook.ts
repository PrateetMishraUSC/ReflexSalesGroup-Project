// Opens an uploaded file, accepts only real .xlsx workbooks, and returns sheets of cells.
import * as XLSX from "xlsx";
import { UnsupportedFileError } from "./errors";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type Cell = {
  t: string;
  v?: string | number | boolean;
  w?: string;
  z?: string;
  f?: string;
};

export type Sheet = { name: string; rows: (Cell | undefined)[][] };

const ZIP_MAGIC = "504b0304";
const OLE_MAGIC = "d0cf11e0";

export function readWorkbook(data: Buffer): Sheet[] {
  if (data.length === 0) {
    throw new UnsupportedFileError("EMPTY_FILE", "The file is empty.");
  }
  if (data.length > MAX_FILE_BYTES) {
    throw new UnsupportedFileError("FILE_TOO_LARGE", "The file is larger than 5 MB. Please upload a smaller line sheet.");
  }

  const magic = data.subarray(0, 4).toString("hex");
  if (magic === OLE_MAGIC) {
    throw new UnsupportedFileError(
      "LEGACY_XLS",
      "This looks like an old .xls file or a password-protected workbook. Open it in Excel, save it as .xlsx without a password, and upload again.",
    );
  }
  if (magic !== ZIP_MAGIC) {
    throw new UnsupportedFileError("NOT_XLSX", "This isn't an Excel .xlsx file. Only .xlsx line sheets are supported.");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "buffer", dense: true, cellNF: true, cellText: true, cellDates: false });
  } catch {
    throw new UnsupportedFileError("UNREADABLE", "The file couldn't be opened as an Excel workbook. It may be damaged.");
  }
  if (workbook.bookType !== "xlsx") {
    throw new UnsupportedFileError("NOT_XLSX", "This isn't an Excel .xlsx file. Only .xlsx line sheets are supported.");
  }

  return workbook.SheetNames.map((name) => ({
    name,
    rows: Array.from((workbook.Sheets[name]["!data"] ?? []) as (Cell[] | undefined)[], (row) => row ?? []),
  }));
}

export function columnLetter(index: number): string {
  return XLSX.utils.encode_col(index);
}

export function cellText(cell: Cell | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  return String(cell.w ?? cell.v).trim();
}
