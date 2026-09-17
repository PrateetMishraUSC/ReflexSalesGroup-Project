// Tests for turning sheet rows into candidate lines with their source cells.
import { describe, expect, it } from "vitest";
import { detectLayout } from "@/lib/parse/detect";
import { UnsupportedFileError } from "@/lib/parse/errors";
import { extractLines } from "@/lib/parse/extract";
import { parseUpload } from "@/lib/parse";
import { readWorkbook } from "@/lib/parse/workbook";
import { fixture, makeWorkbook } from "./helpers/xlsx";

const HEADER = ["Item Code", "Description", "Size", "Units Available", "Cost USD", "Retail USD", "Category"];

describe("Northstar line sheet", () => {
  const offer = parseUpload(fixture("01-northstar-line-sheet.xlsx"));

  it("creates one line per product row, rows 6 to 19, and stops at the footer", () => {
    expect(offer.lines).toHaveLength(14);
    expect(offer.lines.map((l) => l.sheetRow)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(offer.sourceRows.map((r) => r.sheetRow)).toEqual(offer.lines.map((l) => l.sheetRow));
    expect(offer.lines.every((l) => l.sourceCol === "")).toBe(true);
  });

  it("keeps values exactly as the supplier typed them, with their cell reference", () => {
    const byRow = (row: number) => offer.lines.find((l) => l.sheetRow === row)!.raw;
    expect(byRow(6).itemCode).toEqual({ ref: "A6", v: "000101", z: "000000" });
    expect(byRow(7).unitCost).toEqual({ ref: "E7", v: "$3.25", z: "$#,##0.00" });
    expect(byRow(9).unitCost).toEqual({ ref: "E9", v: null });
    expect(byRow(12).quantity).toEqual({ ref: "D12", v: -12, z: "#,##0" });
    expect(byRow(16).itemCode).toEqual({ ref: "A16", v: null });
    expect(byRow(17).quantity).toEqual({ ref: "D17", v: "1,200", z: "#,##0" });
    expect(byRow(18).quantity).toEqual({ ref: "D18", v: "TBD", z: "#,##0" });
    expect(byRow(19).quantity).toEqual({ ref: "D19", v: " 45 ", z: "#,##0" });
  });

  it("stores the original row cells and header names for checking against the sheet", () => {
    expect(offer.headers).toEqual({
      A: "Item Code", B: "Description", C: "Size", D: "Units Available", E: "Cost USD", F: "Retail USD", G: "Category",
    });
    const row12 = offer.sourceRows.find((r) => r.sheetRow === 12)!;
    expect(row12.cells.D).toEqual({ v: -12, z: "#,##0" });
    expect(Object.keys(offer.sourceRows.find((r) => r.sheetRow === 16)!.cells)).not.toContain("A");
  });

  it("carries the offer title and sheet details", () => {
    expect(offer).toMatchObject({ layout: "northstar", sheetName: "Offer", headerRow: 5, title: "Northstar Supply - September offer" });
  });
});

describe("Harbor size grid", () => {
  const offer = parseUpload(fixture("02-harbor-size-grid.xlsx"));

  it("splits each style row into one line per size: 10 rows x 3 sizes = 30 lines", () => {
    expect(offer.sourceRows).toHaveLength(10);
    expect(offer.lines).toHaveLength(30);
    expect(offer.lines.slice(0, 3).map((l) => [l.sheetRow, l.sourceCol, l.raw.size?.v])).toEqual([
      [6, "D", "S"],
      [6, "E", "M"],
      [6, "F", "L"],
    ]);
  });

  it("gives every size line its own quantity cell but shares cost, code and description", () => {
    const b204 = offer.lines.filter((l) => l.sheetRow === 9);
    expect(b204.map((l) => l.raw.quantity)).toEqual([
      { ref: "D9", v: 20, z: "#,##0" },
      { ref: "E9", v: "TBD", z: "#,##0" },
      { ref: "F9", v: 30, z: "#,##0" },
    ]);
    expect(new Set(b204.map((l) => l.raw.unitCost?.ref))).toEqual(new Set(["C9"]));
    expect(b204[0].raw.itemCode).toEqual({ ref: "A9", v: "B204", z: "@" });
    expect(b204[0].raw.size).toEqual({ ref: "D5", v: "S" });
  });

  it("keeps the supplier's Total Units formula result for cross-checking", () => {
    const b201 = offer.lines.find((l) => l.sheetRow === 6)!;
    expect(b201.raw.supplierTotal).toEqual({ ref: "H6", v: 240, z: "#,##0", f: "SUM(D6:F6)" });
    const b204 = offer.lines.find((l) => l.sheetRow === 9)!;
    expect(b204.raw.supplierTotal).toEqual({ ref: "H9", v: null });
  });

  it("leaves category empty because Harbor has no Category column", () => {
    const line = offer.lines[0];
    expect(line.raw.category).toBeNull();
    expect(offer.layout).toBe("harbor");
  });
});

describe("5,000-row file", () => {
  it("produces 5,000 lines from row 6 to row 5005", () => {
    const offer = parseUpload(fixture("03-northstar-5000-rows.xlsx"));
    expect(offer.lines).toHaveLength(5000);
    expect(offer.lines[0].raw.itemCode?.v).toBe("P00001");
    expect(offer.lines.at(-1)).toMatchObject({ sheetRow: 5005, raw: { itemCode: { v: "P05000" } } });
  });
});

describe("row boundaries", () => {
  it("skips blank rows in the middle and ignores anything after the footer", () => {
    const offer = parseUpload(
      makeWorkbook({
        Offer: [
          HEADER,
          ["A1", "Tee", "One size", 5, 2, 9, "Apparel"],
          [],
          ["A2", "Cap", "One size", 6, 3, 9, "Accessories"],
          ["END OF OFFER - thanks"],
          ["A3", "Ignored", "One size", 7, 4, 9, "Home"],
        ],
      }),
    );
    expect(offer.lines.map((l) => [l.sheetRow, l.raw.itemCode?.v])).toEqual([
      [2, "A1"],
      [4, "A2"],
    ]);
  });

  it("keeps a row that has some values but is otherwise incomplete, so it can be reviewed", () => {
    const offer = parseUpload(makeWorkbook({ Offer: [HEADER, ["A1", null, null, null, null, null, null]] }));
    expect(offer.lines).toHaveLength(1);
    expect(offer.lines[0].raw.quantity).toEqual({ ref: "D2", v: null });
  });

  it("rejects a sheet with a header but no product rows", () => {
    expect(() => parseUpload(makeWorkbook({ Offer: [["Title"], HEADER, [], ["End of offer."]] }))).toThrow(
      /no product rows below it/,
    );
  });

  it("rejects a sheet with more rows than the limit", () => {
    const rows = [HEADER, ...Array.from({ length: 4 }, (_, i) => [`A${i}`, "Tee", "One size", 1, 1, 2, "Apparel"])];
    const detected = detectLayout(readWorkbook(makeWorkbook({ Offer: rows })));
    expect(() => extractLines(detected, 3)).toThrow(UnsupportedFileError);
    expect(() => extractLines(detected, 3)).toThrow(/more than 3 product rows/);
  });
});
