// GET /api/offers/:id/export.csv downloads the included lines as CSV, with the matching totals in response headers.
import { handle, parseOfferId, serverTiming } from "@/lib/api/http";
import { exportOffer } from "@/lib/offers/export-offer";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const started = performance.now();
    const result = await exportOffer(parseOfferId((await params).id));

    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Offer-Version": String(result.offerVersion),
        "X-Offer-Status": result.offerStatus,
        "X-Offer-Lines": String(result.lineCount),
        "X-Offer-Pieces": String(result.totals.pieces),
        "X-Offer-Supplier-Value": result.totals.supplierValue,
        "X-Offer-Needs-Review": String(result.totals.needsReviewLines),
        "Server-Timing": serverTiming({ total: Math.round(performance.now() - started) }),
      },
    });
  });
}
