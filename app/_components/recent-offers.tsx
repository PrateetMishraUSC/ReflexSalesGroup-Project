// Table of recent offers with their review status, included pieces and supplier cost.
import Link from "next/link";
import { formatCount, formatUsd, LAYOUT_LABELS, plural } from "@/lib/format";
import type { listOffers } from "@/lib/offers/read-offer";
import { LocalTime } from "./local-time";

type OfferRow = Awaited<ReturnType<typeof listOffers>>[number];

function StatusTag({ offer }: { offer: OfferRow }) {
  if (offer.status === "saved") {
    return <span className="rounded-sm bg-ok px-2 py-0.5 text-xs font-semibold text-ok-ink">Saved</span>;
  }
  if (offer.needsReviewLines > 0) {
    return (
      <span className="rounded-sm bg-review px-2 py-0.5 text-xs font-semibold text-review-ink">
        In review · {plural(offer.needsReviewLines, "line", "lines")} to check
      </span>
    );
  }
  return <span className="rounded-sm bg-sky-soft px-2 py-0.5 text-xs font-semibold text-navy">In review · ready to save</span>;
}

export function RecentOffers({ offers }: { offers: OfferRow[] }) {
  return (
    <section aria-labelledby="recent-heading" className="mt-10">
      <h2 id="recent-heading" className="font-display text-2xl font-semibold tracking-tight text-navy">
        Recent offers
      </h2>

      {offers.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-rule px-4 py-6 text-muted">
          No offers yet. Upload a line sheet to create the first one.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-rule bg-sheet">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-rule text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Offer</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Pieces</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Supplier cost</th>
                <th scope="col" className="px-4 py-2 font-semibold">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id} className="border-b border-rule last:border-0 hover:bg-paper">
                  <td className="px-4 py-3">
                    <Link href={`/offers/${offer.id}`} className="font-semibold text-navy-mid hover:underline">
                      {offer.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {LAYOUT_LABELS[offer.layout]} · <span className="font-mono">{offer.sourceFilename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusTag offer={offer} />
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono">{formatCount(offer.pieces)}</td>
                  <td className="tabular px-4 py-3 text-right font-mono">{formatUsd(offer.supplierValue)}</td>
                  <td className="px-4 py-3 text-muted">
                    <LocalTime iso={offer.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
