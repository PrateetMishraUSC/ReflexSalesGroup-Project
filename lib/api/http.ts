// Shared API helpers: JSON responses, error-to-status mapping, request validation, test hooks and Server-Timing.
import { z } from "zod";
import {
  DecisionNotAllowedError,
  IdempotencyKeyReusedError,
  InvalidEditError,
  NeedsReviewRemainingError,
  NotFoundError,
  SimulatedFailureError,
  VersionConflictError,
} from "@/lib/errors";
import { UnsupportedFileError } from "@/lib/parse/errors";

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export class BadRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BadRequestError";
  }
}

export function errorResponse(error: unknown): Response {
  const body = (code: string, message: string, details?: unknown): ApiErrorBody => ({
    error: details === undefined ? { code, message } : { code, message, details },
  });

  if (error instanceof BadRequestError) return Response.json(body(error.code, error.message, error.details), { status: error.status });
  if (error instanceof UnsupportedFileError) return Response.json(body(error.code, error.message), { status: 422 });
  if (error instanceof NotFoundError) return Response.json(body("NOT_FOUND", error.message), { status: 404 });
  if (error instanceof IdempotencyKeyReusedError) return Response.json(body("IDEMPOTENCY_KEY_REUSED", error.message), { status: 422 });
  if (error instanceof VersionConflictError) {
    return Response.json(body("VERSION_CONFLICT", error.message, { currentVersion: error.currentVersion }), { status: 409 });
  }
  if (error instanceof InvalidEditError) return Response.json(body("INVALID_VALUE", error.message, { issues: error.issues }), { status: 422 });
  if (error instanceof DecisionNotAllowedError) return Response.json(body("DECISION_NOT_ALLOWED", error.message), { status: 422 });
  if (error instanceof NeedsReviewRemainingError) {
    return Response.json(body("NEEDS_REVIEW_REMAINING", error.message, { needsReviewLines: error.count }), { status: 422 });
  }
  if (error instanceof SimulatedFailureError) {
    return Response.json(body("SIMULATED_FAILURE", `The save failed (simulated ${error.point}). Nothing was lost; retry to continue.`), { status: 500 });
  }
  if (error instanceof z.ZodError) {
    return Response.json(body("VALIDATION_ERROR", "The request is not valid.", z.flattenError(error)), { status: 400 });
  }

  console.error(error);
  return Response.json(body("INTERNAL_ERROR", "Something went wrong on the server. Please try again."), { status: 500 });
}

export async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    return errorResponse(error);
  }
}

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new BadRequestError("MISSING_IDEMPOTENCY_KEY", "Send an Idempotency-Key header so retries are safe.");
  if (!idempotencyKeySchema.safeParse(key).success) {
    throw new BadRequestError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8-128 letters, digits, dashes or underscores.");
  }
  return key;
}

export const offerIdSchema = z.uuid();

export function parseOfferId(id: string, what = "Offer"): string {
  if (!offerIdSchema.safeParse(id).success) throw new NotFoundError(what);
  return id;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("INVALID_JSON", "The request body must be valid JSON.");
  }
}

export function replayHeaders(replayed: boolean): Record<string, string> {
  return { "Idempotent-Replayed": String(replayed) };
}

export function testHooksEnabled(): boolean {
  return process.env.ENABLE_TEST_HOOKS === "true";
}

export function simulatedFailure(request: Request): "before-commit" | "after-commit" | undefined {
  if (!testHooksEnabled()) return undefined;
  const value = request.headers.get("x-test-fault");
  return value === "before-commit" || value === "after-commit" ? value : undefined;
}

export function serverTiming(timings: Record<string, number>): string {
  return Object.entries(timings)
    .map(([name, ms]) => `${name};dur=${ms}`)
    .join(", ");
}
