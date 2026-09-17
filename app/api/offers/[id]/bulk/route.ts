// POST /api/offers/:id/bulk leaves out every line that still needs review, in one retry-safe change.
import { z } from "zod";
import { handle, parseOfferId, readJson, replayHeaders, requireIdempotencyKey, simulatedFailure } from "@/lib/api/http";
import { excludeNeedsReview } from "@/lib/offers/edit-line";

const bodySchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  action: z.literal("exclude_needs_review"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const offerId = parseOfferId((await params).id);
    const idempotencyKey = requireIdempotencyKey(request);
    const { expectedVersion } = bodySchema.parse(await readJson(request));

    const { result, replayed } = await excludeNeedsReview(offerId, expectedVersion, {
      idempotencyKey,
      simulateFailure: simulatedFailure(request),
    });
    return Response.json(result, { headers: replayHeaders(replayed) });
  });
}
