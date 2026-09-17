// Retry protection: a request key is claimed in the same transaction as its work, so a repeat returns the first result.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { idempotencyKeys } from "@/db/schema";
import { IdempotencyKeyReusedError } from "@/lib/errors";
import { db } from "./client";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type IdempotentResult<T> = { result: T; replayed: boolean };

export function hashRequest(...parts: (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

export async function findStoredResponse<T>(key: string, requestHash: string): Promise<T | null> {
  const [stored] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  if (!stored) return null;
  if (stored.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
  return stored.response as T;
}

export async function withIdempotency<T extends object>(
  key: string,
  requestHash: string,
  work: (tx: Tx) => Promise<T & { offerId?: string }>,
): Promise<IdempotentResult<T>> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [stored] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
      if (stored.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      return { result: stored.response as T, replayed: true };
    }

    const result = await work(tx);
    await tx
      .update(idempotencyKeys)
      .set({ response: result, offerId: result.offerId ?? null })
      .where(eq(idempotencyKeys.key, key));
    return { result, replayed: false };
  });
}
