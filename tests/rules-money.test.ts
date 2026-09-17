// Tests for exact integer money conversions and line value rounding.
import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  decimalToUnits,
  lineValueCents,
  numberToDecimal,
  unitsToDecimal,
} from "@/lib/rules/money";

describe("converting amounts", () => {
  it("turns decimal text into whole units of $0.0001", () => {
    expect(decimalToUnits("3.25")).toBe(32_500);
    expect(decimalToUnits("4.5")).toBe(45_000);
    expect(decimalToUnits("0.0001")).toBe(1);
    expect(decimalToUnits("12")).toBe(120_000);
    expect(decimalToUnits("-3")).toBe(-30_000);
  });

  it("refuses more than 4 decimal places or non-numbers", () => {
    expect(decimalToUnits("3.12345")).toBeNull();
    expect(decimalToUnits("TBD")).toBeNull();
    expect(decimalToUnits("1e3")).toBeNull();
  });

  it("removes floating point noise from Excel numbers", () => {
    expect(3 * 1.1).not.toBe(3.3);
    expect(numberToDecimal(3 * 1.1)).toBe("3.3");
    expect(numberToDecimal(4.5)).toBe("4.5");
    expect(numberToDecimal(Number.NaN)).toBeNull();
  });

  it("formats units and cents back into decimal text", () => {
    expect(unitsToDecimal(32_500)).toBe("3.25");
    expect(unitsToDecimal(45_000)).toBe("4.50");
    expect(unitsToDecimal(12_345)).toBe("1.2345");
    expect(unitsToDecimal(1_250)).toBe("0.125");
    expect(centsToDecimal(420_800)).toBe("4208.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(18_721_450n)).toBe("187214.50");
  });
});

describe("line value = quantity x unit cost, rounded to cents", () => {
  it("is exact where floating point is not", () => {
    expect(lineValueCents(120, decimalToUnits("4.50")!)).toBe(54_000);
    expect(lineValueCents(3, decimalToUnits("1.1")!)).toBe(330);
    expect(lineValueCents(1200, decimalToUnits("2.1")!)).toBe(252_000);
  });

  it("rounds half a cent up", () => {
    expect(lineValueCents(1, decimalToUnits("0.125")!)).toBe(13);
    expect(lineValueCents(1, decimalToUnits("1.005")!)).toBe(101);
    expect(lineValueCents(1, decimalToUnits("0.1249")!)).toBe(12);
  });

  it("handles the largest allowed line without losing precision", () => {
    expect(lineValueCents(1_000_000, decimalToUnits("100000")!)).toBe(10_000_000_000_000);
  });
});
