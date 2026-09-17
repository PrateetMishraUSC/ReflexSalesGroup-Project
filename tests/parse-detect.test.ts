// Tests for opening workbooks and detecting the Northstar or Harbor layout.
import { describe, expect, it } from "vitest";
import { detectLayout } from "@/lib/parse/detect";
import { UnsupportedFileError, type UnsupportedFileCode } from "@/lib/parse/errors";
import { readWorkbook } from "@/lib/parse/workbook";
import { fixture, makeWorkbook } from "./helpers/xlsx";

const detect = (data: Buffer) => detectLayout(readWorkbook(data));

function expectRejected(action: () => unknown, code: UnsupportedFileCode, messagePart?: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedFileError);
    expect((error as UnsupportedFileError).code).toBe(code);
    if (messagePart) expect((error as Error).message).toContain(messagePart);
    return;
  }
  throw new Error(`Expected the file to be rejected with ${code}`);
}

const NORTHSTAR_HEADER = ["Item Code", "Description", "Size", "Units Available", "Cost USD", "Retail USD", "Category"];

describe("supplied files", () => {
  it("detects the Northstar line sheet: header on row 5, columns by name", () => {
    const result = detect(fixture("01-northstar-line-sheet.xlsx"));
    expect(result.layout).toBe("northstar");
    expect(result.sheet.name).toBe("Offer");
    expect(result.headerRow).toBe(5);
    expect(result.columns).toEqual({
      itemCode: 0, description: 1, size: 2, quantity: 3, unitCost: 4, retailPrice: 5, category: 6,
    });
    expect(result.title).toBe("Northstar Supply - September offer");
  });

  it("detects the Harbor size grid: sizes S, M, L in columns D, E, F", () => {
    const result = detect(fixture("02-harbor-size-grid.xlsx"));
    expect(result.layout).toBe("harbor");
    expect(result.headerRow).toBe(5);
    expect(result.columns).toEqual({ itemCode: 0, description: 1, unitCost: 2, retailPrice: 6, supplierTotal: 7 });
    expect(result.sizeColumns).toEqual([
      { size: "S", col: 3, letter: "D" },
      { size: "M", col: 4, letter: "E" },
      { size: "L", col: 5, letter: "F" },
    ]);
    expect(result.title).toBe("Harbor Apparel - September offer");
  });

  it("detects the 5,000-row file as Northstar", () => {
    const result = detect(fixture("03-northstar-5000-rows.xlsx"));
    expect(result.layout).toBe("northstar");
    expect(result.headerRow).toBe(5);
  });
});

describe("changes the brief says suppliers may make", () => {
  it("finds reordered Northstar columns, a lower header row, and odd spacing or case", () => {
    const data = makeWorkbook({
      Offer: [
        ["Northstar Supply - October offer"],
        [],
        ["Some extra note"],
        [],
        [],
        [],
        [],
        ["Cost USD", "  units   AVAILABLE ", "Category", "Item Code", "Size", "Retail USD", "Description"],
        [4.5, 120, "Apparel", "A1", "One size", 18, "Tee"],
      ],
    });
    const result = detect(data);
    expect(result.layout).toBe("northstar");
    expect(result.headerRow).toBe(8);
    expect(result.columns).toEqual({
      unitCost: 0, quantity: 1, category: 2, itemCode: 3, size: 4, retailPrice: 5, description: 6,
    });
  });

  it("finds Harbor sizes wherever they are, in sheet order", () => {
    const data = makeWorkbook({
      Offer: [["Style", "L", "Product", "S", "Unit Cost USD", "M"]],
    });
    expect(detect(data).sizeColumns.map((s) => `${s.size}:${s.letter}`)).toEqual(["L:B", "S:D", "M:F"]);
  });

  it("works when optional columns (Retail USD, Category) are absent", () => {
    const data = makeWorkbook({ Offer: [["Item Code", "Description", "Size", "Units Available", "Cost USD"]] });
    expect(detect(data).columns.retailPrice).toBeUndefined();
  });

  it("uses a later sheet when the first sheet has no header", () => {
    const data = makeWorkbook({ Notes: [["Read me"]], Offer: [NORTHSTAR_HEADER] });
    expect(detect(data).sheet.name).toBe("Offer");
  });
});

describe("unsupported files get a clear reason", () => {
  it("rejects an empty upload", () => {
    expectRejected(() => detect(Buffer.alloc(0)), "EMPTY_FILE");
  });

  it("rejects a CSV even if renamed to .xlsx", () => {
    expectRejected(() => detect(Buffer.from("Item Code,Description\nA1,Tee\n")), "NOT_XLSX");
  });

  it("rejects old .xls files with advice to re-save", () => {
    expectRejected(() => detect(makeWorkbook({ Offer: [NORTHSTAR_HEADER] }, "biff8")), "LEGACY_XLS", "save it as .xlsx");
  });

  it("rejects other zip-based spreadsheet formats (.ods)", () => {
    expectRejected(() => detect(makeWorkbook({ Offer: [NORTHSTAR_HEADER] }, "ods")), "NOT_XLSX");
  });

  it("names the missing column when a header is almost right", () => {
    const header = NORTHSTAR_HEADER.filter((h) => h !== "Cost USD");
    expectRejected(() => detect(makeWorkbook({ Offer: [["Title"], header] })), "MISSING_COLUMNS", "Cost USD");
  });

  it("says a Harbor sheet needs size columns", () => {
    expectRejected(
      () => detect(makeWorkbook({ Offer: [["Style", "Product", "Unit Cost USD", "Retail USD"]] })),
      "MISSING_COLUMNS",
      "size column",
    );
  });

  it("rejects a sheet with no recognisable header", () => {
    expectRejected(() => detect(makeWorkbook({ Offer: [["Name", "Price"], ["Tee", 4]] })), "NO_HEADER");
  });

  it("rejects a header with the same column twice", () => {
    expectRejected(
      () => detect(makeWorkbook({ Offer: [[...NORTHSTAR_HEADER, "Cost USD"]] })),
      "DUPLICATE_COLUMN",
      "Cost USD",
    );
  });

  it("rejects a header row that matches both layouts", () => {
    const both = [...NORTHSTAR_HEADER, "Style", "Product", "Unit Cost USD", "S"];
    expectRejected(() => detect(makeWorkbook({ Offer: [both] })), "AMBIGUOUS_LAYOUT");
  });
});
