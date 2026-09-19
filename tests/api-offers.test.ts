// Tests for the upload and read API routes: status codes, retry safety, test hooks, pagination and original rows.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getOffer } from "@/app/api/offers/[id]/route";
import { GET as getRow } from "@/app/api/offers/[id]/rows/[sheetRow]/route";
import { GET as listOffers, POST as uploadOffer } from "@/app/api/offers/route";
import { pool } from "@/lib/db/client";
import { resetDb } from "./helpers/db";
import { fixture } from "./helpers/xlsx";

const BASE = "http://localhost:3000";

function uploadRequest(file: Buffer | null, filename: string, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append("file", new File([new Uint8Array(file)], filename));
  return new Request(`${BASE}/api/offers`, { method: "POST", body: form, headers });
}

async function upload(name: string, key = randomUUID(), headers: Record<string, string> = {}) {
  const response = await uploadOffer(uploadRequest(fixture(name), name, { "Idempotency-Key": key, ...headers }));
  return { response, body: await response.json() };
}

const read = (id: string, query = "") =>
  getOffer(new NextRequest(`${BASE}/api/offers/${id}${query}`), { params: Promise.resolve({ id }) });

beforeEach(resetDb);
afterEach(() => {
  delete process.env.ENABLE_TEST_HOOKS;
});
afterAll(() => pool.end());

describe("POST /api/offers", () => {
  it("creates an offer: 201, Location, totals and a Server-Timing breakdown", async () => {
    const { response, body } = await upload("01-northstar-line-sheet.xlsx");
    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(`/offers/${body.offerId}`);
    expect(response.headers.get("Idempotent-Replayed")).toBe("false");
    expect(response.headers.get("Server-Timing")).toMatch(/parseMs;dur=\d+, rulesMs;dur=\d+, dbMs;dur=\d+, sourceRowsMs;dur=\d+, linesMs;dur=\d+, total;dur=\d+/);
    expect(body).toMatchObject({ name: "Northstar Supply - September offer", layout: "northstar", totals: { pieces: 1733, supplierValue: "4208.00" } });
  });

  it("returns the same offer with 200 when the request is retried with the same key", async () => {
    const key = randomUUID();
    const first = await upload("01-northstar-line-sheet.xlsx", key);
    const retry = await upload("01-northstar-line-sheet.xlsx", key);
    expect(retry.response.status).toBe(200);
    expect(retry.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(retry.body.offerId).toBe(first.body.offerId);
  });

  it("rejects a reused key with a different file", async () => {
    const key = randomUUID();
    await upload("01-northstar-line-sheet.xlsx", key);
    const { response, body } = await upload("02-harbor-size-grid.xlsx", key);
    expect(response.status).toBe(422);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it.each([
    ["no Idempotency-Key", {}, "MISSING_IDEMPOTENCY_KEY"],
    ["a malformed Idempotency-Key", { "Idempotency-Key": "a b" }, "INVALID_IDEMPOTENCY_KEY"],
  ])("returns 400 for %s", async (_, headers, code) => {
    const response = await uploadOffer(uploadRequest(fixture("01-northstar-line-sheet.xlsx"), "a.xlsx", headers));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
  });

  it("returns 400 when no file is attached", async () => {
    const response = await uploadOffer(uploadRequest(null, "", { "Idempotency-Key": randomUUID() }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("MISSING_FILE");
  });

  it("returns 422 with a readable reason for an unsupported file", async () => {
    const response = await uploadOffer(uploadRequest(Buffer.from("Item Code,Cost\nA1,3"), "offer.xlsx", { "Idempotency-Key": randomUUID() }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "NOT_XLSX", message: "This isn't an Excel .xlsx file. Only .xlsx line sheets are supported." },
    });
  });

  it("ignores the failure-simulation header unless test hooks are enabled", async () => {
    const { response } = await upload("01-northstar-line-sheet.xlsx", randomUUID(), { "X-Test-Fault": "before-commit" });
    expect(response.status).toBe(201);
  });

  it("with test hooks on, a simulated failure returns 500, stores nothing, and a retry succeeds", async () => {
    process.env.ENABLE_TEST_HOOKS = "true";
    const key = randomUUID();
    const failed = await upload("01-northstar-line-sheet.xlsx", key, { "X-Test-Fault": "before-commit" });
    expect(failed.response.status).toBe(500);
    expect(failed.body.error.code).toBe("SIMULATED_FAILURE");
    expect((await (await listOffers()).json()).offers).toHaveLength(0);

    const retry = await upload("01-northstar-line-sheet.xlsx", key);
    expect(retry.response.status).toBe(201);
    expect((await (await listOffers()).json()).offers).toHaveLength(1);
  });
});

describe("GET /api/offers/:id", () => {
  it("returns the offer, totals, counts and the first page of lines in sheet order", async () => {
    const { body: created } = await upload("01-northstar-line-sheet.xlsx");
    const response = await read(created.offerId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.offer).toMatchObject({ id: created.offerId, status: "in_review", version: 1, headerRow: 5 });
    expect(body.totals).toEqual({ includedLines: 6, excludedLines: 2, needsReviewLines: 6, pieces: 1733, supplierValue: "4208.00", retailValue: "21552.00" });
    expect(body.page).toEqual({ status: "all", page: 1, pageSize: 100, totalLines: 14 });
    expect(body.lines.map((l: { sheetRow: number }) => l.sheetRow)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(body.lines[1]).toMatchObject({ itemCode: "A102", unitCost: "3.25", lineValue: "260.00", retailPrice: "15.00" });
  });

  it("filters by status and pages through lines", async () => {
    const { body: created } = await upload("01-northstar-line-sheet.xlsx");
    const needsReview = await (await read(created.offerId, "?status=needs_review")).json();
    expect(needsReview.lines.map((l: { sheetRow: number }) => l.sheetRow)).toEqual([9, 12, 14, 15, 16, 18]);

    const page2 = await (await read(created.offerId, "?pageSize=5&page=2")).json();
    expect(page2.page).toEqual({ status: "all", page: 2, pageSize: 5, totalLines: 14 });
    expect(page2.lines.map((l: { sheetRow: number }) => l.sheetRow)).toEqual([11, 12, 13, 14, 15]);
  });

  it("serves the 5,000-row offer one page at a time with full totals", async () => {
    const { body: created } = await upload("03-northstar-5000-rows.xlsx");
    const body = await (await read(created.offerId)).json();
    expect(body.lines).toHaveLength(100);
    expect(body.totals).toMatchObject({ includedLines: 5000, pieces: 62_444, supplierValue: "187214.50" });
  });

  it.each([
    ["an unknown offer", randomUUID(), "", 404],
    ["a malformed id", "not-a-uuid", "", 404],
    ["an unknown status filter", null, "?status=approved", 400],
    ["a page size above 500", null, "?pageSize=5000", 400],
  ])("handles %s", async (_, id, query, status) => {
    const { body: created } = await upload("01-northstar-line-sheet.xlsx");
    const response = await read(id ?? created.offerId, query);
    expect(response.status).toBe(status);
  });
});

describe("GET /api/offers/:id/rows/:sheetRow", () => {
  it("returns the original cells and header names for a sheet row", async () => {
    const { body: created } = await upload("01-northstar-line-sheet.xlsx");
    const response = await getRow(new Request(`${BASE}/x`), { params: Promise.resolve({ id: created.offerId, sheetRow: "12" }) });
    const body = await response.json();
    expect(body).toMatchObject({ sheetRow: 12, headerRow: 5, headers: { D: "Units Available" } });
    expect(body.cells.D).toEqual({ v: -12, z: "#,##0" });
  });

  it("returns 404 for a row that is not in the offer", async () => {
    const { body: created } = await upload("01-northstar-line-sheet.xlsx");
    const response = await getRow(new Request(`${BASE}/x`), { params: Promise.resolve({ id: created.offerId, sheetRow: "3" }) });
    expect(response.status).toBe(404);
  });
});

describe("GET /api/offers", () => {
  it("lists recent offers newest first with their included totals", async () => {
    await upload("01-northstar-line-sheet.xlsx");
    await upload("02-harbor-size-grid.xlsx");
    const { offers } = await (await listOffers()).json();
    expect(offers.map((o: { layout: string; pieces: number; supplierValue: string }) => [o.layout, o.pieces, o.supplierValue])).toEqual([
      ["harbor", 1340, "3740.00"],
      ["northstar", 1733, "4208.00"],
    ]);
  });
});
