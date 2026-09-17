// Tests for correcting lines, reviewer decisions, saving, version conflicts, retries, failures and rejected bad data.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as bulkAction } from "@/app/api/offers/[id]/bulk/route";
import { PATCH as patchLine } from "@/app/api/offers/[id]/lines/[lineId]/route";
import { GET as getOffer } from "@/app/api/offers/[id]/route";
import { POST as saveOffer } from "@/app/api/offers/[id]/save/route";
import { POST as uploadOffer } from "@/app/api/offers/route";
import { lineEvents } from "@/db/schema";
import { db, pool } from "@/lib/db/client";
import { resetDb } from "./helpers/db";
import { fixture } from "./helpers/xlsx";

const BASE = "http://localhost:3000";

type LineView = { id: string; sheetRow: number; sourceCol: string; status: string; excludeReason: string | null; quantity: number | null; unitCost: string | null; lineValue: string | null; decision: string | null; edits: Record<string, unknown>; raw: Record<string, unknown>; issues: { code: string; message: string }[] };

async function createOffer(file = "01-northstar-line-sheet.xlsx") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(fixture(file))], file));
  const response = await uploadOffer(new Request(`${BASE}/api/offers`, { method: "POST", body: form, headers: { "Idempotency-Key": randomUUID() } }));
  const { offerId } = await response.json();
  return offerId as string;
}

async function state(offerId: string) {
  const response = await getOffer(new NextRequest(`${BASE}/api/offers/${offerId}`), { params: Promise.resolve({ id: offerId }) });
  const body = await response.json();
  return body as { offer: { version: number; status: string; savedTotals: unknown; savedAt: string | null }; totals: { pieces: number; supplierValue: string; needsReviewLines: number; includedLines: number }; lines: LineView[] };
}

const lineAt = async (offerId: string, sheetRow: number, sourceCol = "") =>
  (await state(offerId)).lines.find((l) => l.sheetRow === sheetRow && l.sourceCol === sourceCol)!;

async function patch(offerId: string, lineId: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await patchLine(
    new Request(`${BASE}/api/offers/${offerId}/lines/${lineId}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...headers },
    }),
    { params: Promise.resolve({ id: offerId, lineId }) },
  );
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function post(handler: typeof saveOffer, path: string, offerId: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await handler(
    new Request(`${BASE}/api/offers/${offerId}/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...headers },
    }),
    { params: Promise.resolve({ id: offerId }) },
  );
  return { status: response.status, headers: response.headers, body: await response.json() };
}

beforeEach(resetDb);
afterEach(() => {
  delete process.env.ENABLE_TEST_HOOKS;
});
afterAll(() => pool.end());

describe("correcting values", () => {
  it("fixing A104's missing cost includes it, updates totals, bumps the version and keeps the original cell", async () => {
    const offerId = await createOffer();
    const row9 = await lineAt(offerId, 9);
    const { status, body } = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: "9.00" } });

    expect(status).toBe(200);
    expect(body.offerVersion).toBe(2);
    expect(body.line).toMatchObject({ status: "included", unitCost: "9.00", lineValue: "540.00", edits: { unitCost: "9.00" } });
    expect(body.line.raw.unitCost).toEqual({ ref: "E9", v: null });
    expect(body.totals).toMatchObject({ pieces: 1793, supplierValue: "4748.00", needsReviewLines: 5 });

    const reloaded = await state(offerId);
    expect(reloaded.offer.version).toBe(2);
    expect(reloaded.totals).toMatchObject({ pieces: 1793, supplierValue: "4748.00" });
    const events = await db.select().from(lineEvents).where(eq(lineEvents.lineId, row9.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "edit", offerVersion: 2, before: { status: "needs_review", unitCost: null } });
  });

  it("accepts a quantity typed as text and applies the same rules as the upload", async () => {
    const offerId = await createOffer();
    const row18 = await lineAt(offerId, 18);
    const { body } = await patch(offerId, row18.id, { expectedVersion: 1, changes: { quantity: " 1,000 " } });
    expect(body.line).toMatchObject({ status: "included", quantity: 1000, lineValue: "4200.00" });
    expect(body.line.issues.map((i: { code: string }) => i.code)).toEqual(["QTY_FROM_TEXT"]);
  });

  it("re-evaluates Harbor siblings when one size is corrected", async () => {
    const offerId = await createOffer("02-harbor-size-grid.xlsx");
    const b204m = await lineAt(offerId, 9, "E");
    const { body } = await patch(offerId, b204m.id, { expectedVersion: 1, changes: { quantity: 45 } });
    expect(body.line.status).toBe("included");
    expect(body.changedLines.map((l: LineView) => `${l.sheetRow}${l.sourceCol}`).sort()).toEqual(["9D", "9E", "9F"]);
    const sibling = body.changedLines.find((l: LineView) => l.sourceCol === "D");
    expect(sibling.issues[0].message).toBe("Supplier's Total Units in H9 is blank; the readable sizes add up to 95.");
    expect(body.totals).toMatchObject({ pieces: 1385, supplierValue: "3920.00" });
  });
});

describe("reviewer decisions", () => {
  it("keeping row 14 of the A108 conflict leaves out row 15 and includes row 14 in the same change", async () => {
    const offerId = await createOffer();
    const row15 = await lineAt(offerId, 15);
    const { body } = await patch(offerId, row15.id, { expectedVersion: 1, decision: "exclude" });
    expect(body.line).toMatchObject({ status: "excluded", excludeReason: "Left out by reviewer", decision: "exclude" });
    expect(body.changedLines.find((l: LineView) => l.sheetRow === 14).status).toBe("included");
    expect(body.totals).toMatchObject({ pieces: 1833, supplierValue: "4708.00" });
  });

  it("keeping both A108 rows takes two decisions and ends with both included", async () => {
    const offerId = await createOffer();
    const [row14, row15] = [await lineAt(offerId, 14), await lineAt(offerId, 15)];
    const first = await patch(offerId, row14.id, { expectedVersion: 1, decision: "include" });
    expect(first.body.line.status).toBe("needs_review");
    const second = await patch(offerId, row15.id, { expectedVersion: 2, decision: "include" });
    expect(second.body.totals).toMatchObject({ pieces: 1933, supplierValue: "5258.00", needsReviewLines: 4 });
  });

  it("undoing a decision with null restores the automatic status", async () => {
    const offerId = await createOffer();
    const row10 = await lineAt(offerId, 10);
    await patch(offerId, row10.id, { expectedVersion: 1, decision: "include" });
    const { body } = await patch(offerId, row10.id, { expectedVersion: 2, decision: null });
    expect(body.line).toMatchObject({ status: "excluded", excludeReason: "Duplicate of row 6", decision: null });
    expect(body.totals.pieces).toBe(1733);
  });

  it.each([
    [18, "Correct this line before including it: Quantity in D18 is \"TBD\", which is not a number of pieces."],
    [13, "This line has no units available, so it cannot be included."],
  ])("refuses to force in row %i and changes nothing", async (sheetRow, message) => {
    const offerId = await createOffer();
    const line = await lineAt(offerId, sheetRow);
    const { status, body } = await patch(offerId, line.id, { expectedVersion: 1, decision: "include" });
    expect(status).toBe(422);
    expect(body.error).toEqual({ code: "DECISION_NOT_ALLOWED", message });
    expect((await state(offerId)).offer.version).toBe(1);
  });

  it("leaving out every questionable line in one action clears the review list", async () => {
    const offerId = await createOffer();
    const { status, body } = await post(bulkAction, "bulk", offerId, { expectedVersion: 1, action: "exclude_needs_review" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ offerVersion: 2, excludedCount: 6, totals: { needsReviewLines: 0, pieces: 1733, supplierValue: "4208.00" } });
  });
});

describe("saving", () => {
  it("refuses to save while lines need review, and leaves the offer unchanged", async () => {
    const offerId = await createOffer();
    const { status, body } = await post(saveOffer, "save", offerId, { expectedVersion: 1 });
    expect(status).toBe(422);
    expect(body.error).toEqual({
      code: "NEEDS_REVIEW_REMAINING",
      message: "6 lines still need review. Correct or leave them out before saving.",
      details: { needsReviewLines: 6 },
    });
    expect((await state(offerId)).offer).toMatchObject({ version: 1, status: "in_review" });
  });

  it("saves with a totals snapshot once every line is decided, and reopens on a later edit", async () => {
    const offerId = await createOffer();
    await post(bulkAction, "bulk", offerId, { expectedVersion: 1, action: "exclude_needs_review" });
    const saved = await post(saveOffer, "save", offerId, { expectedVersion: 2 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ offerVersion: 3, status: "saved", totals: { pieces: 1733, supplierValue: "4208.00" } });

    const afterSave = await state(offerId);
    expect(afterSave.offer).toMatchObject({ status: "saved", version: 3, savedTotals: saved.body.totals });

    const row6 = await lineAt(offerId, 6);
    await patch(offerId, row6.id, { expectedVersion: 3, decision: "exclude" });
    const reopened = await state(offerId);
    expect(reopened.offer).toMatchObject({ status: "in_review", version: 4, savedTotals: saved.body.totals });
  });
});

describe("two windows editing the same offer", () => {
  it("rejects a change based on an old version with 409 and keeps the newer work", async () => {
    const offerId = await createOffer();
    const [row9, row12] = [await lineAt(offerId, 9), await lineAt(offerId, 12)];
    await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } });

    const stale = await patch(offerId, row12.id, { expectedVersion: 1, changes: { quantity: 12 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 2 } });

    const now = await state(offerId);
    expect(now.offer.version).toBe(2);
    expect(now.lines.find((l) => l.sheetRow === 9)!.unitCost).toBe("9.00");
    expect(now.lines.find((l) => l.sheetRow === 12)!.status).toBe("needs_review");
  });

  it("lets exactly one of two simultaneous edits from the same version win", async () => {
    const offerId = await createOffer();
    const [row9, row12] = [await lineAt(offerId, 9), await lineAt(offerId, 12)];
    const results = await Promise.all([
      patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }),
      patch(offerId, row12.id, { expectedVersion: 1, changes: { quantity: 12 } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await state(offerId)).offer.version).toBe(2);
  });
});

describe("retries and failures", () => {
  it("replays a retried edit instead of applying it twice", async () => {
    const offerId = await createOffer();
    const row9 = await lineAt(offerId, 9);
    const key = randomUUID();
    const first = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key });
    const retry = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(retry.body).toEqual(first.body);
    expect((await state(offerId)).offer.version).toBe(2);
  });

  it("rejects the same key with a different edit", async () => {
    const offerId = await createOffer();
    const row9 = await lineAt(offerId, 9);
    const key = randomUUID();
    await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key });
    const reused = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 10 } }, { "Idempotency-Key": key });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("a failed save stores nothing; retrying the same edit succeeds once", async () => {
    process.env.ENABLE_TEST_HOOKS = "true";
    const offerId = await createOffer();
    const row9 = await lineAt(offerId, 9);
    const key = randomUUID();

    const failed = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key, "X-Test-Fault": "before-commit" });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe("SIMULATED_FAILURE");
    const between = await state(offerId);
    expect(between.offer.version).toBe(1);
    expect(between.lines.find((l) => l.sheetRow === 9)).toMatchObject({ unitCost: null, status: "needs_review" });

    const retry = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key });
    expect(retry.status).toBe(200);
    expect((await state(offerId)).offer.version).toBe(2);
  });

  it("a save whose reply was lost is recovered by retrying, without a second version bump", async () => {
    process.env.ENABLE_TEST_HOOKS = "true";
    const offerId = await createOffer();
    const row9 = await lineAt(offerId, 9);
    const key = randomUUID();

    const lost = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key, "X-Test-Fault": "after-commit" });
    expect(lost.status).toBe(500);
    expect((await state(offerId)).offer.version).toBe(2);

    const retry = await patch(offerId, row9.id, { expectedVersion: 1, changes: { unitCost: 9 } }, { "Idempotency-Key": key });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await state(offerId)).offer.version).toBe(2);
  });
});

describe("bad data sent straight to the backend is rejected and the saved offer is preserved", () => {
  it.each([
    ["negative quantity", { changes: { quantity: -5 } }, 422, "INVALID_VALUE"],
    ["text quantity", { changes: { quantity: "abc" } }, 422, "INVALID_VALUE"],
    ["fractional quantity", { changes: { quantity: 1.5 } }, 422, "INVALID_VALUE"],
    ["huge quantity", { changes: { quantity: 99_999_999 } }, 422, "INVALID_VALUE"],
    ["cleared quantity", { changes: { quantity: null } }, 422, "INVALID_VALUE"],
    ["zero cost", { changes: { unitCost: 0 } }, 422, "INVALID_VALUE"],
    ["negative cost", { changes: { unitCost: -1 } }, 422, "INVALID_VALUE"],
    ["NaN cost", { changes: { unitCost: "NaN" } }, 422, "INVALID_VALUE"],
    ["non-USD cost", { changes: { unitCost: "€3.00" } }, 422, "INVALID_VALUE"],
    ["cost with too many decimals", { changes: { unitCost: "1.23456" } }, 422, "INVALID_VALUE"],
    ["an attempt to set status directly", { changes: { status: "included" } }, 400, "VALIDATION_ERROR"],
    ["an unknown top-level field", { offerId: "x", changes: { quantity: 5 } }, 400, "VALIDATION_ERROR"],
    ["an invalid decision", { decision: "approve" }, 400, "VALIDATION_ERROR"],
    ["a boolean quantity", { changes: { quantity: true } }, 400, "VALIDATION_ERROR"],
    ["an empty change", { changes: {} }, 400, "VALIDATION_ERROR"],
  ])("rejects %s", async (_, change, status, code) => {
    const offerId = await createOffer();
    const before = await state(offerId);
    const row6 = before.lines.find((l) => l.sheetRow === 6)!;

    const response = await patch(offerId, row6.id, { expectedVersion: 1, ...change });
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);

    const after = await state(offerId);
    expect(after.offer.version).toBe(1);
    expect(after.totals).toEqual(before.totals);
    expect(after.lines.find((l) => l.sheetRow === 6)).toEqual(row6);
  });

  it("explains an invalid value in plain language", async () => {
    const offerId = await createOffer();
    const row6 = await lineAt(offerId, 6);
    const { body } = await patch(offerId, row6.id, { expectedVersion: 1, changes: { quantity: -5 } });
    expect(body.error.message).toBe("Quantity is -5; available pieces cannot be negative.");
  });

  it.each([
    ["missing expectedVersion", { changes: { quantity: 5 } }, 400],
    ["malformed JSON", "{not json", 400],
  ])("rejects %s", async (_, body, status) => {
    const offerId = await createOffer();
    const row6 = await lineAt(offerId, 6);
    expect((await patch(offerId, row6.id, body)).status).toBe(status);
  });

  it("returns 404 for a line that belongs to another offer, without changing either offer", async () => {
    const offerA = await createOffer();
    const offerB = await createOffer("02-harbor-size-grid.xlsx");
    const lineFromB = (await state(offerB)).lines[0];
    const response = await patch(offerA, lineFromB.id, { expectedVersion: 1, changes: { quantity: 5 } });
    expect(response.status).toBe(404);
    expect((await state(offerA)).offer.version).toBe(1);
    expect((await state(offerB)).offer.version).toBe(1);
  });

  it("returns 404 for a malformed line id", async () => {
    const offerId = await createOffer();
    expect((await patch(offerId, "not-a-uuid", { expectedVersion: 1, decision: "exclude" })).status).toBe(404);
  });
});
