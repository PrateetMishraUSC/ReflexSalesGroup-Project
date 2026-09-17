// Saves an offer: refuses while lines need review, otherwise records the totals snapshot and marks it saved.
import { eq, sql } from "drizzle-orm";
import { lineEvents, offers } from "@/db/schema";
import { hashRequest } from "@/lib/db/idempotency";
import { NeedsReviewRemainingError } from "@/lib/errors";
import type { OfferTotals } from "@/lib/rules/offer";
import { bumpVersion, runOfferChange, type FailurePoint } from "./offer-change";
import { getTotals } from "./read-offer";

export type SaveResponse = { offerId: string; offerVersion: number; status: "saved"; savedAt: string; totals: OfferTotals };

export async function saveOffer(
  offerId: string,
  expectedVersion: number,
  options: { idempotencyKey: string; simulateFailure?: FailurePoint },
) {
  const requestHash = hashRequest("POST save", offerId, String(expectedVersion));

  return runOfferChange<SaveResponse>({ ...options, requestHash }, async (tx) => {
    const offerVersion = await bumpVersion(tx, offerId, expectedVersion, false);
    const totals = await getTotals(offerId, tx);
    if (totals.needsReviewLines > 0) throw new NeedsReviewRemainingError(totals.needsReviewLines);

    const [saved] = await tx
      .update(offers)
      .set({ status: "saved", savedAt: sql`now()`, savedTotals: totals })
      .where(eq(offers.id, offerId))
      .returning({ savedAt: offers.savedAt });
    await tx.insert(lineEvents).values({ offerId, action: "save", after: { totals }, offerVersion });

    return { offerId, offerVersion, status: "saved", savedAt: saved.savedAt!.toISOString(), totals };
  });
}
