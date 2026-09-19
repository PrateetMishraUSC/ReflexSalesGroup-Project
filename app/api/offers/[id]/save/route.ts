// POST /api/offers/:id/save marks the offer saved with a totals snapshot, refusing while lines still need review.
import { z } from "zod";
import { handle, parseOfferId, readJson, replayHeaders, requireIdempotencyKey, serverTiming, simulatedFailure } from "@/lib/api/http";
import { saveOffer } from "@/lib/offers/save-offer";

const bodySchema = z.strictObject({ expectedVersion: z.number().int().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const started = performance.now();
    const offerId = parseOfferId((await params).id);
    const idempotencyKey = requireIdempotencyKey(request);
    const { expectedVersion } = bodySchema.parse(await readJson(request));

    const { result, replayed } = await saveOffer(offerId, expectedVersion, {
      idempotencyKey,
      simulateFailure: simulatedFailure(request),
    });
    return Response.json(result, {
      headers: { ...replayHeaders(replayed), "Server-Timing": serverTiming({ total: Math.round(performance.now() - started) }) },
    });
  });
}
