// Browser-side API calls for one offer: reads a page, and sends retry-safe changes with version checks.
import type { OfferPage } from "@/lib/offers/read-offer";

export type LineView = OfferPage["lines"][number];
export type OfferHeader = OfferPage["offer"];
export type OfferTotalsView = OfferPage["totals"];
export type StatusFilter = OfferPage["page"]["status"];

export type SourceRowView = {
  sheetName: string;
  headerRow: number;
  headers: Record<string, string>;
  sheetRow: number;
  cells: Record<string, { v: string | number | boolean | null; w?: string; z?: string; f?: string }>;
};

export type ApiFailure =
  | { kind: "conflict"; currentVersion: number; message: string }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "unreachable"; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

export async function fetchOfferPage(offerId: string, status: StatusFilter, page: number, pageSize: number): Promise<OfferPage> {
  const response = await fetch(`/api/offers/${offerId}?status=${status}&page=${page}&pageSize=${pageSize}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the offer (HTTP ${response.status})`);
  return response.json();
}

export async function fetchSourceRow(offerId: string, sheetRow: number): Promise<SourceRowView> {
  const response = await fetch(`/api/offers/${offerId}/rows/${sheetRow}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load sheet row ${sheetRow}`);
  return response.json();
}

export async function sendChange<T>(path: string, body: unknown, idempotencyKey: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: path.includes("/lines/") ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: { kind: "unreachable", message: "Couldn't reach the server, so this change may or may not have been saved." } };
  }

  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };

  if (response.status === 409) {
    return {
      ok: false,
      failure: { kind: "conflict", currentVersion: payload?.error?.details?.currentVersion ?? 0, message: payload?.error?.message ?? "This offer changed in another window." },
    };
  }
  if (response.status >= 500) {
    return { ok: false, failure: { kind: "unreachable", message: payload?.error?.message ?? `The server failed (HTTP ${response.status}).` } };
  }
  return {
    ok: false,
    failure: { kind: "rejected", code: payload?.error?.code ?? "REJECTED", message: payload?.error?.message ?? `The change was rejected (HTTP ${response.status}).` },
  };
}
