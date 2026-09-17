// Test helpers for the database: empty all tables and read Postgres error codes.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function resetDb() {
  await db.execute(sql`TRUNCATE offers, idempotency_keys RESTART IDENTITY CASCADE`);
}

export function pgErrorCode(error: unknown): string | undefined {
  const err = error as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
}

export function pgConstraint(error: unknown): string | undefined {
  const err = error as { constraint?: string; cause?: { constraint?: string } };
  return err.cause?.constraint ?? err.constraint;
}

export async function expectDbRejects(action: () => Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await action();
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error("Expected the database to reject this write");
}
