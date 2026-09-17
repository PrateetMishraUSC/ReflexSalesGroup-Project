// GET /api/offers/:id returns the offer, its totals, counts and one filtered page of lines.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, parseOfferId, serverTiming } from "@/lib/api/http";
import { getOfferPage } from "@/lib/offers/read-offer";

const querySchema = z.object({
  status: z.enum(["all", "included", "excluded", "needs_review"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const started = performance.now();
    const offerId = parseOfferId((await params).id);
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = await getOfferPage(offerId, query);
    return Response.json(page, {
      headers: { "Server-Timing": serverTiming({ total: Math.round(performance.now() - started) }) },
    });
  });
}
