// Review screen: tabs, lines table, side panel and save state, with version checks and retry-safe changes.
"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { fetchOfferPage, sendChange, type ApiFailure, type LineView, type StatusFilter } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import type { OfferPage } from "@/lib/offers/read-offer";
import { LinePanel, type LineEditFields } from "./line-panel";
import { LinesTable } from "./lines-table";
import { SummaryBar } from "./summary-bar";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string }
  | { kind: "conflict"; message: string };

const TABS: { id: StatusFilter; label: string }[] = [
  { id: "needs_review", label: "Needs review" },
  { id: "included", label: "Included" },
  { id: "excluded", label: "Left out" },
  { id: "all", label: "All lines" },
];

export function OfferReview({ offerId, initial, pageSize }: { offerId: string; initial: OfferPage; pageSize: number }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<StatusFilter>(initial.page.status);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [lineError, setLineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retry = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(
    async (nextTab: StatusFilter, nextPage: number) => {
      const fresh = await fetchOfferPage(offerId, nextTab, nextPage, pageSize);
      setData(fresh);
      setTab(nextTab);
      setPage(nextPage);
      return fresh;
    },
    [offerId, pageSize],
  );

  const handleFailure = useCallback((failure: ApiFailure, again: () => Promise<void>) => {
    if (failure.kind === "rejected") {
      setLineError(failure.message);
      setSave({ kind: "idle" });
      return;
    }
    if (failure.kind === "conflict") {
      setSave({ kind: "conflict", message: failure.message });
      return;
    }
    retry.current = again;
    setSave({ kind: "failed", message: failure.message });
  }, []);

  const change = useCallback(
    async (path: string, body: Record<string, unknown>, expectedVersion: number): Promise<number | null> => {
      const key = crypto.randomUUID();
      let newVersion: number | null = null;

      const run = async () => {
        setBusy(true);
        setSave({ kind: "saving" });
        setLineError(null);
        const result = await sendChange<{ offerVersion: number }>(path, { ...body, expectedVersion }, key);
        if (result.ok) {
          retry.current = null;
          newVersion = result.data.offerVersion;
          await load(tab, page);
          setSave({ kind: "saved", at: new Date().toLocaleTimeString() });
        } else {
          handleFailure(result.failure, run);
        }
        setBusy(false);
      };

      await run();
      return newVersion;
    },
    [handleFailure, load, page, tab],
  );

  const selected = data.lines.find((line) => line.id === selectedId) ?? null;
  const conflictRows = selected
    ? data.lines.filter(
        (line) =>
          line.id !== selected.id &&
          line.itemCode !== null &&
          line.itemCode.toUpperCase() === selected.itemCode?.toUpperCase() &&
          (line.size ?? "").toUpperCase() === (selected.size ?? "").toUpperCase(),
      )
    : [];

  const counts: Record<StatusFilter, number> = {
    needs_review: data.totals.needsReviewLines,
    included: data.totals.includedLines,
    excluded: data.totals.excludedLines,
    all: data.totals.needsReviewLines + data.totals.includedLines + data.totals.excludedLines,
  };

  async function applyEdits(fields: LineEditFields) {
    if (!selected) return;
    const changes: Record<string, string | number | null> = {};
    if (fields.itemCode !== undefined) changes.itemCode = fields.itemCode.trim();
    if (fields.size !== undefined) changes.size = fields.size.trim();
    if (fields.quantity !== undefined) changes.quantity = fields.quantity.trim();
    if (fields.unitCost !== undefined) changes.unitCost = fields.unitCost.trim();
    await change(`/api/offers/${offerId}/lines/${selected.id}`, { changes }, data.offer.version);
  }

  async function decide(line: LineView, decision: "include" | "exclude" | null, expectedVersion = data.offer.version) {
    return change(`/api/offers/${offerId}/lines/${line.id}`, { decision }, expectedVersion);
  }

  async function decideEach(lines: LineView[], decision: "include" | "exclude") {
    let version: number | null = data.offer.version;
    for (const line of lines) {
      version = await decide(line, decision, version);
      if (version === null) return;
    }
  }

  const group = () => [selected, ...conflictRows].filter((line): line is LineView => line !== null);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Link href="/" className="text-sm font-semibold text-navy-mid hover:underline">
        ← All offers
      </Link>

      <div className="mt-3">
        <SummaryBar
          offerId={offerId}
          offer={data.offer}
          totals={data.totals}
          saving={busy}
          onSave={() => void change(`/api/offers/${offerId}/save`, {}, data.offer.version)}
        />
      </div>

      <div aria-live="polite" className="mt-3 space-y-2">
        {save.kind === "saving" && <p className="text-sm text-muted">Saving…</p>}
        {save.kind === "saved" && <p className="text-sm text-ok-ink">Saved at {save.at}</p>}
        {save.kind === "failed" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-error px-3 py-2 text-sm text-error-ink">
            <span>Not saved. {save.message}</span>
            <button
              type="button"
              onClick={() => void retry.current?.()}
              className="rounded-[10px] bg-error-ink px-3 py-1 font-semibold text-white hover:opacity-90"
            >
              Retry
            </button>
            <span>Retrying is safe: the same change is never applied twice.</span>
          </div>
        )}
        {save.kind === "conflict" && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-review px-3 py-2 text-sm text-review-ink">
            <span>{save.message}</span>
            <button
              type="button"
              onClick={() => void load(tab, page).then(() => setSave({ kind: "idle" }))}
              className="rounded-[10px] border border-review-ink px-3 py-1 font-semibold hover:bg-white/50"
            >
              Reload this offer
            </button>
          </div>
        )}
        {data.totals.needsReviewLines > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-rule bg-sheet px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{formatCount(data.totals.needsReviewLines)} lines need review.</span> They are not counted in the totals.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void change(`/api/offers/${offerId}/bulk`, { action: "exclude_needs_review" }, data.offer.version)}
              className="rounded-[10px] border border-navy px-3 py-1 font-semibold text-navy hover:bg-paper disabled:opacity-50"
            >
              Leave out all {formatCount(data.totals.needsReviewLines)}
            </button>
          </div>
        )}
      </div>

      <nav aria-label="Filter lines" className="mt-4 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => void load(item.id, 1)}
            className={`rounded-[10px] px-3 py-1.5 text-sm font-semibold ${tab === item.id ? "bg-navy text-white" : "border border-rule bg-sheet hover:bg-paper"}`}
          >
            {item.label} <span className="tabular font-mono">{formatCount(counts[item.id])}</span>
          </button>
        ))}
      </nav>

      <div className={selected ? "grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]" : ""}>
        <LinesTable
          lines={data.lines}
          page={page}
          pageSize={pageSize}
          totalLines={data.page.totalLines}
          selectedId={selectedId}
          onSelect={(line) => {
            setSelectedId(line.id);
            setLineError(null);
          }}
          onPageChange={(next) => void load(tab, next)}
        />

        {selected && (
          <div className="mt-4">
            <LinePanel
              key={selected.id}
              offerId={offerId}
              line={selected}
              conflictRows={conflictRows}
              busy={busy}
              error={lineError}
              onClose={() => setSelectedId(null)}
              onApply={(fields) => void applyEdits(fields)}
              onDecision={(decision) => void decide(selected, decision)}
              onKeepOnly={(keep) => void decideEach(group().filter((line) => line.id !== keep.id), "exclude")}
              onKeepBoth={() => void decideEach(group(), "include")}
            />
          </div>
        )}
      </div>
    </main>
  );
}
