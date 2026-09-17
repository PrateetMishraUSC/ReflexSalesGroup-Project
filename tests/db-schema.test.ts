// Tests that Postgres itself rejects invalid offer lines, even when the app code is bypassed.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { lines, offers, sourceRows } from "@/db/schema";
import { db, pool } from "@/lib/db/client";
import { expectDbRejects, resetDb } from "./helpers/db";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INVALID_ENUM = "22P02";

let offerId: string;
let lineId: string;

const validLine = {
  sheetRow: 6,
  sourceCol: "",
  itemCode: "000101",
  description: "Cotton crew tee",
  size: "One size",
  category: "Apparel",
  quantity: 120,
  unitCost: "4.5000",
  retailPrice: "18.0000",
  lineValue: "540.00",
  retailValue: "2160.00",
  status: "included" as const,
  raw: {} as never,
};

beforeEach(async () => {
  await resetDb();
  const [offer] = await db
    .insert(offers)
    .values({
      name: "Northstar Supply - September offer",
      layout: "northstar",
      sourceFilename: "01-northstar-line-sheet.xlsx",
      sourceSha256: "abc",
      sheetName: "Offer",
      headerRow: 5,
      headers: { A: "Item Code" },
    })
    .returning({ id: offers.id });
  offerId = offer.id;
  const [line] = await db.insert(lines).values({ ...validLine, offerId }).returning({ id: lines.id });
  lineId = line.id;
});

afterAll(() => pool.end());

const update = (setClause: ReturnType<typeof sql>) =>
  db.execute(sql`UPDATE lines SET ${setClause} WHERE id = ${lineId}`);

describe("lines table protects the numbers", () => {
  it("stores a valid included line with exact decimals", async () => {
    const [row] = await db.select().from(lines).where(eq(lines.id, lineId));
    expect(row).toMatchObject({ quantity: 120, unitCost: "4.5000", lineValue: "540.00", edits: {}, issues: [] });
  });

  it.each([
    ["a negative quantity", sql`quantity = -5, line_value = NULL, status = 'needs_review'`, "lines_quantity_range"],
    ["a quantity above the limit", sql`quantity = 2000000, line_value = NULL, status = 'needs_review'`, "lines_quantity_range"],
    ["a zero cost", sql`unit_cost = 0, line_value = NULL, status = 'needs_review'`, "lines_unit_cost_range"],
    ["a negative cost", sql`unit_cost = -1, line_value = NULL, status = 'needs_review'`, "lines_unit_cost_range"],
    ["a line value that does not equal quantity x cost", sql`line_value = 999.99`, "lines_line_value_matches"],
    ["a changed quantity without recomputing the value", sql`quantity = 121`, "lines_line_value_matches"],
    ["an included line with no cost", sql`unit_cost = NULL, line_value = NULL`, "lines_included_is_complete"],
    ["an included line with zero pieces", sql`quantity = 0, line_value = 0`, "lines_included_is_complete"],
    ["an excluded line without a reason", sql`status = 'excluded'`, "lines_excluded_has_reason"],
  ])("rejects %s", async (_, setClause, constraint) => {
    const result = await expectDbRejects(() => update(setClause));
    expect(result).toEqual({ code: CHECK_VIOLATION, constraint });
    const [row] = await db.select().from(lines).where(eq(lines.id, lineId));
    expect(row).toMatchObject({ quantity: 120, unitCost: "4.5000", lineValue: "540.00", status: "included" });
  });

  it("rejects an unknown status", async () => {
    const result = await expectDbRejects(() => update(sql`status = 'approved'`));
    expect(result.code).toBe(INVALID_ENUM);
  });

  it("allows a questionable line to be stored for review without a cost", async () => {
    await update(sql`unit_cost = NULL, line_value = NULL, status = 'needs_review'`);
    const [row] = await db.select().from(lines).where(eq(lines.id, lineId));
    expect(row.status).toBe("needs_review");
  });

  it("rejects the same sheet row and size twice in one offer", async () => {
    const result = await expectDbRejects(() => db.insert(lines).values({ ...validLine, offerId }));
    expect(result).toEqual({ code: UNIQUE_VIOLATION, constraint: "lines_offer_row_col_key" });
  });

  it("allows the same sheet row in a different offer", async () => {
    const [other] = await db
      .insert(offers)
      .values({ name: "Second", layout: "northstar", sourceFilename: "x.xlsx", sourceSha256: "abc", sheetName: "Offer", headerRow: 5, headers: {} })
      .returning({ id: offers.id });
    await db.insert(lines).values({ ...validLine, offerId: other.id });
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(lines);
    expect(count).toBe(2);
  });
});

describe("offers table", () => {
  it("rejects a saved offer without a totals snapshot", async () => {
    const result = await expectDbRejects(() => db.execute(sql`UPDATE offers SET status = 'saved' WHERE id = ${offerId}`));
    expect(result).toEqual({ code: CHECK_VIOLATION, constraint: "offers_saved_has_totals" });
  });

  it("deleting an offer removes its lines and source rows", async () => {
    await db.insert(sourceRows).values({ offerId, sheetRow: 6, cells: { A: { v: "000101" } } });
    await db.delete(offers).where(eq(offers.id, offerId));
    const [{ lineCount }] = await db.select({ lineCount: sql<number>`count(*)::int` }).from(lines);
    const [{ rowCount }] = await db.select({ rowCount: sql<number>`count(*)::int` }).from(sourceRows);
    expect([lineCount, rowCount]).toEqual([0, 0]);
  });
});
