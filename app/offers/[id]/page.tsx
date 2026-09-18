// Review page for one offer: loads the first page of lines on the server, then hands over to the review screen.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { NotFoundError } from "@/lib/errors";
import { getTotals, getOfferPage, type OfferPage } from "@/lib/offers/read-offer";
import { OfferReview } from "./_components/offer-review";

export const PAGE_SIZE = 100;

async function loadOffer(id: string): Promise<OfferPage | null> {
  try {
    const totals = await getTotals(id);
    const status = totals.needsReviewLines > 0 ? "needs_review" : "all";
    return await getOfferPage(id, { status, page: 1, pageSize: PAGE_SIZE });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export default async function OfferPageRoute({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const initial = await loadOffer(id);
  if (!initial) notFound();

  return <OfferReview offerId={id} initial={initial} pageSize={PAGE_SIZE} />;
}
