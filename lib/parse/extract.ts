// Turns the data rows under the header into candidate lines, keeping the source cell of every value.
import type { DetectedLayout } from "./detect";
import { UnsupportedFileError } from "./errors";
import { FOOTER_PREFIXES, MAX_DATA_ROWS, type Field, type LayoutId } from "./layouts";
import { cellText, columnLetter, type Cell, type Sheet } from "./workbook";

export type CellSnapshot = {
  v: string | number | boolean | null;
  w?: string;
  z?: string;
  f?: string;
};

export type RawField = CellSnapshot & { ref: string };

export type LineField = Exclude<Field, "supplierTotal">;

export type CandidateLine = {
  sheetRow: number;
  sourceCol: string;
  raw: Record<LineField, RawField | null> & { supplierTotal: RawField | null };
};

export type SourceRow = {
  sheetRow: number;
  cells: Record<string, CellSnapshot>;
};

export type ExtractedOffer = {
  layout: LayoutId;
  sheetName: string;
  title: string | null;
  headerRow: number;
  headers: Record<string, string>;
  sourceRows: SourceRow[];
  lines: CandidateLine[];
};

const LINE_FIELDS: LineField[] = ["itemCode", "description", "size", "quantity", "unitCost", "retailPrice", "category"];

function snapshot(cell: Cell | undefined): CellSnapshot {
  if (!cell || cell.v === undefined || cell.v === null) return { v: null };
  const snap: CellSnapshot = { v: cell.v };
  if (cell.w !== undefined && cell.w !== String(cell.v)) snap.w = cell.w;
  if (cell.z && cell.z !== "General") snap.z = cell.z;
  if (cell.f) snap.f = cell.f;
  return snap;
}

function rawField(row: Sheet["rows"][number], sheetRow: number, col: number | undefined): RawField | null {
  if (col === undefined) return null;
  return { ref: `${columnLetter(col)}${sheetRow}`, ...snapshot(row[col]) };
}

const isBlank = (row: Sheet["rows"][number]) => row.every((cell) => cellText(cell) === "");

function isFooter(row: Sheet["rows"][number]) {
  const first = row.map(cellText).find(Boolean)?.toLowerCase() ?? "";
  return FOOTER_PREFIXES.some((prefix) => first.startsWith(prefix));
}

export function extractLines(detected: DetectedLayout, maxRows = MAX_DATA_ROWS): ExtractedOffer {
  const { sheet, layout, columns, sizeColumns, headerIndex } = detected;
  const headerCells = sheet.rows[headerIndex];
  const headers: Record<string, string> = {};
  headerCells.forEach((cell, col) => {
    const text = cellText(cell);
    if (text) headers[columnLetter(col)] = text;
  });

  const sourceRows: SourceRow[] = [];
  const lines: CandidateLine[] = [];

  for (let index = headerIndex + 1; index < sheet.rows.length; index++) {
    const row = sheet.rows[index];
    if (isBlank(row)) continue;
    if (isFooter(row)) break;

    const sheetRow = index + 1;
    if (sourceRows.length >= maxRows) {
      throw new UnsupportedFileError(
        "TOO_MANY_ROWS",
        `The sheet has more than ${maxRows.toLocaleString("en-US")} product rows. Please split it into smaller files.`,
      );
    }

    const cells: Record<string, CellSnapshot> = {};
    row.forEach((cell, col) => {
      if (cellText(cell) !== "") cells[columnLetter(col)] = snapshot(cell);
    });
    sourceRows.push({ sheetRow, cells });

    const shared = Object.fromEntries(
      LINE_FIELDS.map((field) => [field, rawField(row, sheetRow, columns[field])]),
    ) as Record<LineField, RawField | null>;
    const supplierTotal = rawField(row, sheetRow, columns.supplierTotal);

    if (layout === "northstar") {
      lines.push({ sheetRow, sourceCol: "", raw: { ...shared, supplierTotal } });
      continue;
    }

    for (const sizeColumn of sizeColumns) {
      lines.push({
        sheetRow,
        sourceCol: sizeColumn.letter,
        raw: {
          ...shared,
          size: { ref: `${sizeColumn.letter}${detected.headerRow}`, v: sizeColumn.size },
          quantity: rawField(row, sheetRow, sizeColumn.col),
          supplierTotal,
        },
      });
    }
  }

  if (sourceRows.length === 0) {
    throw new UnsupportedFileError(
      "NO_DATA_ROWS",
      `Found the header on row ${detected.headerRow} of sheet "${sheet.name}", but there are no product rows below it.`,
    );
  }

  return {
    layout,
    sheetName: sheet.name,
    title: detected.title,
    headerRow: detected.headerRow,
    headers,
    sourceRows,
    lines,
  };
}
