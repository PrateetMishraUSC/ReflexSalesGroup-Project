// PATCH /api/offers/:id/lines/:lineId corrects a value or records include/leave-out, with version check and retry safety.
import { z } from "zod";
import { handle, parseOfferId, readJson, replayHeaders, requireIdempotencyKey, simulatedFailure } from "@/lib/api/http";
import { editLine } from "@/lib/offers/edit-line";

const value = z.union([z.number(), z.string().max(100)]).nullable();

const bodySchema = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    changes: z
      .strictObject({ itemCode: z.string().max(100).nullable(), size: z.string().max(100).nullable(), quantity: value, unitCost: value })
      .partial()
      .optional(),
    decision: z.enum(["include", "exclude"]).nullable().optional(),
  })
  .refine((body) => (body.changes && Object.keys(body.changes).length > 0) || body.decision !== undefined, {
    message: "Send at least one change or a decision.",
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  return handle(async () => {
    const { id, lineId } = await params;
    const offerId = parseOfferId(id);
    const parsedLineId = parseOfferId(lineId, "Line");
    const idempotencyKey = requireIdempotencyKey(request);
    const body = bodySchema.parse(await readJson(request));

    const { result, replayed } = await editLine(offerId, parsedLineId, body, {
      idempotencyKey,
      simulateFailure: simulatedFailure(request),
    });
    return Response.json(result, { headers: replayHeaders(replayed) });
  });
}
