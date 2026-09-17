// Tests for offer rules, reviewer decisions and totals on the supplied files.
import { describe, expect, it } from "vitest";
import { parseUpload } from "@/lib/parse";
import { reviewOffer } from "@/lib/rules";
import { cleanLine } from "@/lib/rules/clean-line";
import { evaluateOffer, type Decision, type EvaluatedLine } from "@/lib/rules/offer";
import { fixture, makeWorkbook } from "./helpers/xlsx";

const northstar = parseUpload(fixture("01-northstar-line-sheet.xlsx"));
const harbor = parseUpload(fixture("02-harbor-size-grid.xlsx"));

const key = (line: EvaluatedLine) => `${line.sheetRow}${line.sourceCol}`;

function withDecisions(decisions: Record<string, Decision>) {
  return evaluateOffer(
    northstar.lines.map((line) => ({ ...cleanLine(line), decision: decisions[String(line.sheetRow)] ?? null })),
  );
}

describe("Northstar line sheet with default rules", () => {
  const { lines, totals } = reviewOffer(northstar);
  const statusByRow = Object.fromEntries(lines.map((l) => [key(l), [l.status, l.excludeReason]]));

  it("gives every row the expected status and reason", () => {
    expect(statusByRow).toEqual({
      "6": ["included", null],
      "7": ["included", null],
      "8": ["included", null],
      "9": ["needs_review", null],
      "10": ["excluded", "Duplicate of row 6"],
      "11": ["included", null],
      "12": ["needs_review", null],
      "13": ["excluded", "No units available"],
      "14": ["needs_review", null],
      "15": ["needs_review", null],
      "16": ["needs_review", null],
      "17": ["included", null],
      "18": ["needs_review", null],
      "19": ["included", null],
    });
  });

  it("totals 1,733 pieces and $4,208.00 at supplier cost, with retail kept separate", () => {
    expect(totals).toEqual({
      includedLines: 6,
      excludedLines: 2,
      needsReviewLines: 6,
      pieces: 1733,
      supplierValue: "4208.00",
      retailValue: "21552.00",
    });
  });

  it("explains the A108 conflict on both rows", () => {
    const row14 = lines.find((l) => l.sheetRow === 14)!;
    expect(row14.issues.map((i) => i.code)).toEqual(["DUPLICATE_CONFLICT"]);
    expect(row14.issues[0].message).toBe(
      "A108 (One size) is also listed in row 15 with a different quantity or cost. Keep one, keep both, or leave them out.",
    );
  });

  it("computes each line value exactly", () => {
    expect(lines.find((l) => l.sheetRow === 17)!.lineValue).toBe(252_000);
    expect(lines.find((l) => l.sheetRow === 9)!.lineValue).toBeNull();
  });
});

describe("reviewer decisions and corrections", () => {
  it("keeping row 14 of the A108 conflict includes it and leaves row 15 out", () => {
    const { lines, totals } = withDecisions({ "15": "exclude" });
    expect(lines.find((l) => l.sheetRow === 14)!.status).toBe("included");
    expect(lines.find((l) => l.sheetRow === 15)).toMatchObject({ status: "excluded", excludeReason: "Left out by reviewer" });
    expect(totals).toMatchObject({ pieces: 1833, supplierValue: "4708.00" });
  });

  it("keeping both A108 rows includes both with a warning", () => {
    const { lines, totals } = withDecisions({ "14": "include", "15": "include" });
    const row15 = lines.find((l) => l.sheetRow === 15)!;
    expect(row15.status).toBe("included");
    expect(row15.issues.map((i) => i.code)).toEqual(["DUPLICATE_KEPT_BOTH"]);
    expect(totals).toMatchObject({ pieces: 1933, supplierValue: "5258.00" });
  });

  it("putting the exact duplicate back counts 000101 twice", () => {
    const { totals } = withDecisions({ "10": "include" });
    expect(totals).toMatchObject({ pieces: 1853, supplierValue: "4748.00" });
  });

  it("leaving out the first copy of a duplicate keeps the second", () => {
    const { lines, totals } = withDecisions({ "6": "exclude" });
    expect(lines.find((l) => l.sheetRow === 10)!.status).toBe("included");
    expect(totals).toMatchObject({ pieces: 1733, supplierValue: "4208.00" });
  });

  it("leaving out a questionable row moves it from needs review to left out", () => {
    const { lines, totals } = withDecisions({ "12": "exclude" });
    expect(lines.find((l) => l.sheetRow === 12)).toMatchObject({ status: "excluded", excludeReason: "Left out by reviewer" });
    expect(totals).toMatchObject({ needsReviewLines: 5, excludedLines: 3, pieces: 1733 });
  });

  it("cannot force in a row whose values are invalid or a row with zero stock", () => {
    const { lines } = withDecisions({ "18": "include", "13": "include" });
    expect(lines.find((l) => l.sheetRow === 18)!.status).toBe("needs_review");
    expect(lines.find((l) => l.sheetRow === 13)!.status).toBe("excluded");
  });

  it("correcting A104's missing cost to 9.00 includes it", () => {
    const edited = northstar.lines.map((line) =>
      line.sheetRow === 9 ? { ...line, raw: { ...line.raw, unitCost: { ref: "", v: 9 } } } : line,
    );
    const { lines, totals } = evaluateOffer(edited.map((line) => ({ ...cleanLine(line), decision: null })));
    expect(lines.find((l) => l.sheetRow === 9)!.status).toBe("included");
    expect(totals).toMatchObject({ pieces: 1793, supplierValue: "4748.00" });
  });

  it("gives the same result when evaluated twice, without doubling offer issues", () => {
    const once = reviewOffer(northstar);
    const twice = evaluateOffer(once.lines);
    expect(twice).toEqual(once);
  });
});

describe("Harbor size grid with default rules", () => {
  const { lines, totals } = reviewOffer(harbor);
  const byKey = Object.fromEntries(lines.map((l) => [key(l), l]));

  it("includes 22 size lines: 1,340 pieces and $3,740.00", () => {
    expect(totals).toEqual({
      includedLines: 22,
      excludedLines: 3,
      needsReviewLines: 5,
      pieces: 1340,
      supplierValue: "3740.00",
      retailValue: "16144.00",
    });
  });

  it("includes the good sizes of a style even when another size is bad", () => {
    expect([byKey["9D"].status, byKey["9E"].status, byKey["9F"].status]).toEqual(["included", "needs_review", "included"]);
    expect([byKey["15D"].status, byKey["15E"].status, byKey["15F"].status]).toEqual(["included", "needs_review", "included"]);
  });

  it("leaves out B205 because every size is zero", () => {
    expect(["11D", "11E", "11F"].map((k) => byKey[k].excludeReason)).toEqual(Array(3).fill("No units available"));
  });

  it("flags B209 where the supplier's total counted the -3", () => {
    const warning = byKey["15D"].issues.find((i) => i.code === "SUPPLIER_TOTAL_MISMATCH")!;
    expect(warning.message).toBe("Supplier's Total Units in H15 is 21, but the readable sizes add up to 24 (M not counted).");
    expect(warning.severity).toBe("warning");
  });

  it("flags B204 where the supplier's total is blank", () => {
    expect(byKey["9D"].issues.map((i) => i.code)).toEqual(["SUPPLIER_TOTAL_MISSING"]);
  });

  it("does not treat the same code in different sizes as duplicates", () => {
    expect(lines.some((l) => l.issues.some((i) => i.code.startsWith("DUPLICATE")))).toBe(false);
  });
});

describe("5,000-row file", () => {
  it("includes every line: 62,444 pieces and $187,214.50", () => {
    const { totals } = reviewOffer(parseUpload(fixture("03-northstar-5000-rows.xlsx")));
    expect(totals).toEqual({
      includedLines: 5000,
      excludedLines: 0,
      needsReviewLines: 0,
      pieces: 62_444,
      supplierValue: "187214.50",
      retailValue: "1031508.00",
    });
  });
});

describe("other offer checks", () => {
  it("warns when cost is above the reference retail price but still includes the line", () => {
    const offer = parseUpload(
      makeWorkbook({ Offer: [["Item Code", "Description", "Size", "Units Available", "Cost USD", "Retail USD"], ["Z1", "Lamp", "One size", 2, 30, 25]] }),
    );
    const [line] = reviewOffer(offer).lines;
    expect(line.status).toBe("included");
    expect(line.issues.map((i) => i.code)).toEqual(["COST_ABOVE_RETAIL"]);
  });

  it("matches duplicates regardless of letter case", () => {
    const offer = parseUpload(
      makeWorkbook({
        Offer: [
          ["Item Code", "Description", "Size", "Units Available", "Cost USD"],
          ["a1", "Tee", "one size", 5, 2],
          ["A1", "Tee", "One size", 7, 2],
        ],
      }),
    );
    expect(reviewOffer(offer).lines.map((l) => l.status)).toEqual(["needs_review", "needs_review"]);
  });
});
