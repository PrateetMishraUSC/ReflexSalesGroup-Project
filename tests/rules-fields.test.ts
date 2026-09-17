// Tests for field rules on every trap in the supplied files and on edge cases.
import { describe, expect, it } from "vitest";
import { parseUpload } from "@/lib/parse";
import type { RawField } from "@/lib/parse/extract";
import { cleanLine } from "@/lib/rules/clean-line";
import {
  parseDescription,
  parseItemCode,
  parseQuantity,
  parseRetailPrice,
  parseSize,
  parseUnitCost,
} from "@/lib/rules/fields";
import { fixture } from "./helpers/xlsx";

const cell = (v: RawField["v"], extra: Partial<RawField> = {}): RawField => ({ ref: "X1", v, ...extra });
const codes = (result: { issues: { code: string }[] }) => result.issues.map((i) => i.code);

describe("item code", () => {
  it("keeps a text code with leading zeros exactly", () => {
    expect(parseItemCode(cell("000101", { z: "000000" }))).toEqual({ value: "000101", issues: [] });
  });

  it("restores leading zeros when Excel stored the code as a number with a 000000 format", () => {
    const result = parseItemCode(cell(101, { z: "000000" }));
    expect(result.value).toBe("000101");
    expect(codes(result)).toEqual(["CODE_ZERO_PADDED"]);
  });

  it("trims spaces and flags a missing code", () => {
    expect(parseItemCode(cell(" A102 ")).value).toBe("A102");
    expect(codes(parseItemCode(cell(null)))).toEqual(["CODE_MISSING"]);
    expect(codes(parseItemCode(cell("   ")))).toEqual(["CODE_MISSING"]);
  });
});

describe("quantity", () => {
  it.each([
    [120, 120, []],
    [0, 0, []],
    ["1,200", 1200, ["QTY_FROM_TEXT"]],
    [" 45 ", 45, ["QTY_FROM_TEXT"]],
  ])("accepts %j as %d", (input, expected, expectedCodes) => {
    const result = parseQuantity(cell(input));
    expect(result.value).toBe(expected);
    expect(codes(result)).toEqual(expectedCodes);
  });

  it.each([
    ["TBD", "QTY_NOT_NUMBER"],
    [null, "QTY_MISSING"],
    ["", "QTY_MISSING"],
    [-12, "QTY_NEGATIVE"],
    ["-3", "QTY_NEGATIVE"],
    [12.5, "QTY_NOT_WHOLE"],
    ["1,2,00", "QTY_NOT_NUMBER"],
    [5_000_000, "QTY_TOO_LARGE"],
    [true, "QTY_NOT_NUMBER"],
  ])("rejects %j with %s", (input, code) => {
    const result = parseQuantity(cell(input));
    expect(result.value).toBeNull();
    expect(codes(result)).toEqual([code]);
    expect(result.issues[0].severity).toBe("error");
  });

  it("explains the problem with the cell and the original value", () => {
    const [issue] = parseQuantity({ ref: "D18", v: "TBD" }).issues;
    expect(issue).toMatchObject({ cell: "D18", raw: "TBD", field: "quantity" });
    expect(issue.message).toBe('Quantity in D18 is "TBD", which is not a number of pieces.');
  });
});

describe("unit cost", () => {
  it.each([
    [4.5, 45_000, []],
    ["$3.25", 32_500, ["COST_FROM_TEXT"]],
    ["US$ 1,250.50", 12_505_000, ["COST_FROM_TEXT"]],
    ["2.10 USD", 21_000, ["COST_FROM_TEXT"]],
    [0.0001, 1, []],
  ])("accepts %j", (input, units, expectedCodes) => {
    const result = parseUnitCost(cell(input));
    expect(result.value).toBe(units);
    expect(codes(result)).toEqual(expectedCodes);
  });

  it.each([
    [null, "COST_MISSING"],
    [0, "COST_NOT_POSITIVE"],
    [-1, "COST_NOT_POSITIVE"],
    ["€3.00", "COST_NOT_NUMBER"],
    ["free", "COST_NOT_NUMBER"],
    [1.23456, "COST_TOO_PRECISE"],
    [250_000, "COST_TOO_LARGE"],
  ])("rejects %j with %s", (input, code) => {
    const result = parseUnitCost(cell(input));
    expect(result.value).toBeNull();
    expect(codes(result)).toEqual([code]);
  });
});

describe("retail price, size and description", () => {
  it("treats retail as optional and never blocks a line", () => {
    expect(parseRetailPrice(cell(null))).toEqual({ value: null, issues: [] });
    expect(parseRetailPrice(cell(18)).value).toBe(180_000);
    const bad = parseRetailPrice(cell(-5));
    expect(bad.value).toBeNull();
    expect(bad.issues[0]).toMatchObject({ code: "RETAIL_INVALID", severity: "warning" });
  });

  it("requires a size but only warns about a missing description", () => {
    expect(parseSize(cell(" One size ")).value).toBe("One size");
    expect(parseSize(cell(null)).issues[0].severity).toBe("error");
    expect(parseDescription(cell(null)).issues[0].severity).toBe("warning");
  });
});

describe("supplied files, row by row", () => {
  const issueCodesByRow = (file: string) => {
    const result: Record<string, string[]> = {};
    for (const line of parseUpload(fixture(file)).lines.map(cleanLine)) {
      const key = `${line.sheetRow}${line.sourceCol}`;
      if (line.issues.length) result[key] = line.issues.map((i) => i.code);
    }
    return result;
  };

  it("finds exactly the Northstar traps", () => {
    expect(issueCodesByRow("01-northstar-line-sheet.xlsx")).toEqual({
      "7": ["COST_FROM_TEXT"],
      "9": ["COST_MISSING"],
      "12": ["QTY_NEGATIVE"],
      "16": ["CODE_MISSING"],
      "17": ["QTY_FROM_TEXT"],
      "18": ["QTY_NOT_NUMBER"],
      "19": ["QTY_FROM_TEXT"],
    });
  });

  it("finds exactly the Harbor traps, per size", () => {
    expect(issueCodesByRow("02-harbor-size-grid.xlsx")).toEqual({
      "9E": ["QTY_NOT_NUMBER"],
      "13D": ["COST_MISSING"],
      "13E": ["COST_MISSING"],
      "13F": ["COST_MISSING"],
      "15E": ["QTY_NEGATIVE"],
    });
  });

  it("finds no issues in the 5,000-row file", () => {
    expect(issueCodesByRow("03-northstar-5000-rows.xlsx")).toEqual({});
  });

  it("produces clean values for a normal Northstar row", () => {
    const row6 = cleanLine(parseUpload(fixture("01-northstar-line-sheet.xlsx")).lines[0]);
    expect(row6).toEqual({
      sheetRow: 6,
      sourceCol: "",
      itemCode: "000101",
      description: "Cotton crew tee",
      size: "One size",
      category: "Apparel",
      quantity: 120,
      unitCost: 45_000,
      retailPrice: 180_000,
      supplierTotal: null,
      supplierTotalCell: null,
      issues: [],
    });
  });
});
