// GET /api/offers/:id/rows/:sheetRow returns the original sheet cells for checking a line against the source.
import { z } from "zod";
import { handle, parseOfferId } from "@/lib/api/http";
import { NotFoundError } from "@/lib/errors";
import { getSourceRow } from "@/lib/offers/read-offer";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sheetRow: string }> }) {
  return handle(async () => {
    const { id, sheetRow } = await params;
    const row = z.coerce.number().int().min(1).safeParse(sheetRow);
    if (!row.success) throw new NotFoundError("Sheet row");
    return Response.json(await getSourceRow(parseOfferId(id), row.data));
  });
}
