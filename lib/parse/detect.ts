// Finds the header row, decides Northstar or Harbor, and maps columns by header name.
import { UnsupportedFileError } from "./errors";
import { HEADER_SEARCH_ROWS, LAYOUTS, type Field, type LayoutId, type LayoutSpec } from "./layouts";
import { cellText, columnLetter, type Sheet } from "./workbook";

export type SizeColumn = { size: string; col: number; letter: string };

export type DetectedLayout = {
  layout: LayoutId;
  sheet: Sheet;
  headerIndex: number;
  headerRow: number;
  columns: Partial<Record<Field, number>>;
  sizeColumns: SizeColumn[];
  title: string | null;
};

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

type RowMatch = {
  spec: LayoutSpec;
  columns: Partial<Record<Field, number>>;
  sizeColumns: SizeColumn[];
  missing: Field[];
  duplicates: string[];
};

function matchRow(row: Sheet["rows"][number], spec: LayoutSpec): RowMatch {
  const columns: Partial<Record<Field, number>> = {};
  const sizeColumns: SizeColumn[] = [];
  const duplicates: string[] = [];
  const sizeSet = new Set((spec.sizeHeaders ?? []).map(normalize));
  const fieldByHeader = new Map(
    Object.entries(spec.columns).map(([field, header]) => [normalize(header!), field as Field]),
  );

  row.forEach((cell, col) => {
    const text = normalize(cellText(cell));
    if (!text) return;
    const field = fieldByHeader.get(text);
    if (field) {
      if (columns[field] !== undefined) duplicates.push(spec.columns[field]!);
      else columns[field] = col;
    } else if (sizeSet.has(text)) {
      const size = cellText(cell).toUpperCase();
      if (sizeColumns.some((s) => s.size === size)) duplicates.push(size);
      else sizeColumns.push({ size, col, letter: columnLetter(col) });
    }
  });

  const missing = spec.required.filter((field) => columns[field] === undefined);
  return { spec, columns, sizeColumns, missing, duplicates };
}

const isComplete = (m: RowMatch) => m.missing.length === 0 && (!m.spec.sizeHeaders || m.sizeColumns.length > 0);

export function detectLayout(sheets: Sheet[]): DetectedLayout {
  let closest: { match: RowMatch; sheet: Sheet; index: number } | null = null;

  for (const sheet of sheets) {
    const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS);
    for (let index = 0; index < limit; index++) {
      const matches = LAYOUTS.map((spec) => matchRow(sheet.rows[index], spec));
      const complete = matches.filter(isComplete);

      if (complete.length > 1) {
        throw new UnsupportedFileError(
          "AMBIGUOUS_LAYOUT",
          `Row ${index + 1} of sheet "${sheet.name}" has both Northstar and Harbor columns, so the layout is unclear.`,
        );
      }
      if (complete.length === 1) {
        const match = complete[0];
        if (match.duplicates.length > 0) {
          throw new UnsupportedFileError(
            "DUPLICATE_COLUMN",
            `Row ${index + 1} of sheet "${sheet.name}" has the column "${match.duplicates[0]}" more than once. Remove the extra column and upload again.`,
          );
        }
        return {
          layout: match.spec.id,
          sheet,
          headerIndex: index,
          headerRow: index + 1,
          columns: match.columns,
          sizeColumns: match.sizeColumns,
          title: findTitle(sheet, index),
        };
      }

      for (const match of matches) {
        const found = match.spec.required.length - match.missing.length;
        const bestFound = closest ? closest.match.spec.required.length - closest.match.missing.length : 0;
        if (found >= 2 && found > bestFound) closest = { match, sheet, index };
      }
    }
  }

  if (closest) {
    const { match, sheet, index } = closest;
    const missingNames = match.missing.map((field) => match.spec.columns[field]);
    if (match.spec.sizeHeaders && match.sizeColumns.length === 0) missingNames.push("at least one size column (S, M, L…)");
    throw new UnsupportedFileError(
      "MISSING_COLUMNS",
      `Row ${index + 1} of sheet "${sheet.name}" looks like a ${match.spec.label} header, but these columns are missing: ${missingNames.join(", ")}.`,
    );
  }

  throw new UnsupportedFileError(
    "NO_HEADER",
    `Couldn't find a supported header in the first ${HEADER_SEARCH_ROWS} rows. Expected Northstar columns (Item Code, Description, Size, Units Available, Cost USD) or Harbor columns (Style, Product, Unit Cost USD, and sizes such as S, M, L).`,
  );
}

function findTitle(sheet: Sheet, headerIndex: number): string | null {
  for (let i = 0; i < headerIndex; i++) {
    const text = sheet.rows[i]?.map(cellText).find(Boolean);
    if (text) return text;
  }
  return null;
}
