// Offer summary: available pieces, supplier cost to pay, reference retail kept separate, and the save and export actions.
"use client";

import { formatCount, formatUsd, LAYOUT_LABELS } from "@/lib/format";
import type { OfferHeader, OfferTotalsView } from "@/lib/api/client";
import { LocalTime } from "@/app/_components/local-time";

type Props = {
  offerId: string;
  offer: OfferHeader;
  totals: OfferTotalsView;
  saving: boolean;
  onSave: () => void;
};

export function SummaryBar({ offerId, offer, totals, saving, onSave }: Props) {
  const changedSinceSave = offer.status === "in_review" && offer.savedTotals !== null;

  return (
    <section aria-labelledby="offer-heading" className="rounded-2xl border border-rule bg-sheet p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="offer-heading" className="font-display text-3xl font-bold tracking-tight text-navy">
            {offer.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {LAYOUT_LABELS[offer.layout]} layout · <span className="font-mono">{offer.sourceFilename}</span> · sheet &ldquo;{offer.sheetName}&rdquo;, header row {offer.headerRow}
          </p>
          <p className="mt-1 text-sm">
            {offer.status === "saved" ? (
              <span className="rounded-sm bg-ok px-2 py-0.5 font-semibold text-ok-ink">
                Saved <LocalTime iso={offer.savedAt!} />
              </span>
            ) : changedSinceSave ? (
              <span className="rounded-sm bg-review px-2 py-0.5 font-semibold text-review-ink">Changed since last save</span>
            ) : (
              <span className="rounded-sm bg-sky-soft px-2 py-0.5 font-semibold text-navy">In review</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/offers/${offerId}/export.csv`}
            className="rounded-[10px] border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-paper"
          >
            Download CSV
          </a>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save offer"}
          </button>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[10px] bg-paper p-4">
          <dt className="text-sm text-muted">Available pieces</dt>
          <dd className="tabular font-mono text-2xl font-semibold text-navy">{formatCount(totals.pieces)}</dd>
          <dd className="text-xs text-muted">across {formatCount(totals.includedLines)} included lines</dd>
        </div>
        <div className="rounded-[10px] bg-sky-soft p-4">
          <dt className="text-sm font-semibold text-navy">Supplier cost to pay</dt>
          <dd className="tabular font-mono text-2xl font-semibold text-navy">{formatUsd(totals.supplierValue)}</dd>
          <dd className="text-xs text-navy">what Reflex pays the supplier</dd>
        </div>
        <div className="rounded-[10px] border border-rule p-4">
          <dt className="text-sm text-muted">Reference retail value</dt>
          <dd className="tabular font-mono text-2xl font-semibold text-muted">{formatUsd(totals.retailValue)}</dd>
          <dd className="text-xs text-muted">reference only, not payable</dd>
        </div>
      </dl>
    </section>
  );
}
