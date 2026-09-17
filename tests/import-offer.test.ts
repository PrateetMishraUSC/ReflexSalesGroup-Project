// Tests that importing stores offers correctly, matches rule totals, and never doubles stock on retries or failures.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { idempotencyKeys, lineEvents, lines, offers, sourceRows } from "@/db/schema";
import { db, pool } from "@/lib/db/client";
import { IdempotencyKeyReusedError, SimulatedFailureError } from "@/lib/errors";
import { importOffer, type InsertMode } from "@/lib/offers/import-offer";
import { UnsupportedFileError } from "@/lib/parse/errors";
import { resetDb } from "./helpers/db";
import { fixture } from "./helpers/xlsx";

const NORTHSTAR = "01-northstar-line-sheet.xlsx";
const HARBOR = "02-harbor-size-grid.xlsx";
const BIG = "03-northstar-5000-rows.xlsx";

const upload = (file: string, key = randomUUID(), extra: { insertMode?: InsertMode; simulateFailure?: "before-commit" | "after-commit" } = {}) =>
  importOffer({ file: fixture(file), filename: file, idempotencyKey: key, ...extra });

async function counts() {
  const count = async (table: typeof offers | typeof lines | typeof sourceRows | typeof idempotencyKeys | typeof lineEvents) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n;
  return {
    offers: await count(offers),
    lines: await count(lines),
    sourceRows: await count(sourceRows),
    keys: await count(idempotencyKeys),
    events: await count(lineEvents),
  };
}

async function dbTotals(offerId: string) {
  const [row] = await db
    .select({
      lines: sql<number>`count(*)::int`,
      pieces: sql<number>`coalesce(sum(${lines.quantity}), 0)::int`,
      supplierValue: sql<string>`coalesce(sum(${lines.lineValue}), 0)::numeric(16,2)::text`,
      retailValue: sql<string>`coalesce(sum(${lines.retailValue}), 0)::numeric(16,2)::text`,
    })
    .from(lines)
    .where(sql`${lines.offerId} = ${offerId} and ${lines.status} = 'included'`);
  return row;
}

beforeEach(resetDb);
afterAll(() => pool.end());

describe("importing the supplied files", () => {
  it("stores the Northstar offer: 14 lines, 14 source rows, and database totals equal the rule totals", async () => {
    const { response, replayed } = await upload(NORTHSTAR);
    expect(replayed).toBe(false);
    expect(response).toMatchObject({ name: "Northstar Supply - September offer", layout: "northstar" });
    expect(response.totals).toMatchObject({ pieces: 1733, supplierValue: "4208.00" });
    expect(await counts()).toEqual({ offers: 1, lines: 14, sourceRows: 14, keys: 1, events: 1 });
    expect(await dbTotals(response.offerId)).toEqual({ lines: 6, pieces: 1733, supplierValue: "4208.00", retailValue: "21552.00" });
  });

  it("keeps the original cell, issues and exact money for a questionable row", async () => {
    const { response } = await upload(NORTHSTAR);
    const [row18] = await db.select().from(lines).where(sql`${lines.offerId} = ${response.offerId} and ${lines.sheetRow} = 18`);
    expect(row18).toMatchObject({ itemCode: "A110", quantity: null, unitCost: "4.2000", status: "needs_review", edits: {} });
    expect(row18.raw.quantity).toEqual({ ref: "D18", v: "TBD", z: "#,##0" });
    expect(row18.issues.map((i) => i.code)).toEqual(["QTY_NOT_NUMBER"]);
  });

  it("stores Harbor as 30 size lines from 10 source rows: $3,740.00", async () => {
    const { response } = await upload(HARBOR);
    expect(await counts()).toMatchObject({ lines: 30, sourceRows: 10 });
    expect(await dbTotals(response.offerId)).toMatchObject({ lines: 22, pieces: 1340, supplierValue: "3740.00" });
  });

  it("stores all 5,000 rows with batched inserts: 62,444 pieces and $187,214.50", async () => {
    const { response } = await upload(BIG, randomUUID(), { insertMode: "batch" });
    expect(await dbTotals(response.offerId)).toEqual({ lines: 5000, pieces: 62_444, supplierValue: "187214.50", retailValue: "1031508.00" });
  });

  it("gives identical results with row-by-row inserts", async () => {
    const batch = await upload(HARBOR, randomUUID(), { insertMode: "batch" });
    const row = await upload(HARBOR, randomUUID(), { insertMode: "row" });
    expect(await dbTotals(row.response.offerId)).toEqual(await dbTotals(batch.response.offerId));
  });
});

describe("retries never double stock", () => {
  it("returns the same offer when the same upload is sent again with the same key", async () => {
    const key = randomUUID();
    const first = await upload(NORTHSTAR, key);
    const second = await upload(NORTHSTAR, key);
    expect(second.replayed).toBe(true);
    expect(second.response).toEqual(first.response);
    expect(await counts()).toMatchObject({ offers: 1, lines: 14, keys: 1 });
  });

  it("creates only one offer when the same key arrives twice at the same moment", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([upload(NORTHSTAR, key), upload(NORTHSTAR, key)]);
    expect(a.response.offerId).toBe(b.response.offerId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await counts()).toMatchObject({ offers: 1, lines: 14 });
  });

  it("refuses to reuse a key for a different file and stores nothing new", async () => {
    const key = randomUUID();
    await upload(NORTHSTAR, key);
    await expect(upload(HARBOR, key)).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await counts()).toMatchObject({ offers: 1, lines: 14 });
  });

  it("keeps a deliberate second upload of the same file as a separate offer and points to the earlier one", async () => {
    const first = await upload(NORTHSTAR);
    const second = await upload(NORTHSTAR);
    expect(second.response.offerId).not.toBe(first.response.offerId);
    expect(second.response.earlierUploads.map((e) => e.id)).toEqual([first.response.offerId]);
    expect(await counts()).toMatchObject({ offers: 2, lines: 28 });
  });
});

describe("failures leave a clear, recoverable state", () => {
  it("a failure before commit stores nothing, and retrying with the same key succeeds once", async () => {
    const key = randomUUID();
    await expect(upload(NORTHSTAR, key, { simulateFailure: "before-commit" })).rejects.toBeInstanceOf(SimulatedFailureError);
    expect(await counts()).toEqual({ offers: 0, lines: 0, sourceRows: 0, keys: 0, events: 0 });

    const retry = await upload(NORTHSTAR, key);
    expect(retry.replayed).toBe(false);
    expect(await counts()).toMatchObject({ offers: 1, lines: 14, keys: 1 });
  });

  it("a failure after commit (reply lost) is recovered by retrying: same offer, 5,000 lines not 10,000", async () => {
    const key = randomUUID();
    await expect(upload(BIG, key, { simulateFailure: "after-commit" })).rejects.toBeInstanceOf(SimulatedFailureError);
    expect(await counts()).toMatchObject({ offers: 1, lines: 5000 });

    const retry = await upload(BIG, key);
    expect(retry.replayed).toBe(true);
    expect(await counts()).toMatchObject({ offers: 1, lines: 5000, keys: 1 });
    const [offer] = await db.select().from(offers).where(eq(offers.id, retry.response.offerId));
    expect(offer.name).toBe("Northstar Supply - volume sample");
  });

  it("an unsupported file stores nothing and uses up no key", async () => {
    const key = randomUUID();
    await expect(
      importOffer({ file: Buffer.from("Item Code,Cost\nA1,3"), filename: "fake.xlsx", idempotencyKey: key }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
    expect(await counts()).toEqual({ offers: 0, lines: 0, sourceRows: 0, keys: 0, events: 0 });
  });
});
