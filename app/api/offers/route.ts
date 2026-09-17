// POST /api/offers uploads a line sheet (retry-safe); GET /api/offers lists recent offers.
import { BadRequestError, handle, requireIdempotencyKey, serverTiming, simulatedFailure, testHooksEnabled } from "@/lib/api/http";
import { importOffer, type InsertMode } from "@/lib/offers/import-offer";
import { listOffers } from "@/lib/offers/read-offer";
import { MAX_FILE_BYTES } from "@/lib/parse/workbook";

export const maxDuration = 60;

function insertMode(request: Request): InsertMode {
  const fromHeader = testHooksEnabled() ? request.headers.get("x-insert-mode") : null;
  const mode = fromHeader ?? process.env.IMPORT_INSERT_MODE;
  return mode === "row" ? "row" : "batch";
}

export async function POST(request: Request) {
  return handle(async () => {
    const started = performance.now();
    const idempotencyKey = requireIdempotencyKey(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new BadRequestError("INVALID_UPLOAD", "Send the spreadsheet as multipart/form-data in a field named \"file\".");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new BadRequestError("MISSING_FILE", "Choose a spreadsheet to upload (form field \"file\").");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestError("FILE_TOO_LARGE", "The file is larger than 4 MB. Please upload a smaller line sheet.", 413);
    }

    const { response, replayed, timings } = await importOffer({
      file: Buffer.from(await file.arrayBuffer()),
      filename: file.name || "upload.xlsx",
      idempotencyKey,
      insertMode: insertMode(request),
      simulateFailure: simulatedFailure(request),
    });

    return Response.json(response, {
      status: replayed ? 200 : 201,
      headers: {
        Location: `/offers/${response.offerId}`,
        "Idempotent-Replayed": String(replayed),
        "Server-Timing": serverTiming({ ...timings, total: Math.round(performance.now() - started) }),
      },
    });
  });
}

export async function GET() {
  return handle(async () => Response.json({ offers: await listOffers() }));
}
