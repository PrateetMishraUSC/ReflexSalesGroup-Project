import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// One connection pool per server process. In development, Next.js hot reload
// re-imports this file, so the pool is kept on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { pool?: Pool };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (see .env.example)");
  return new Pool({ connectionString, max: 5 });
}

export const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool);
export type Db = typeof db;
