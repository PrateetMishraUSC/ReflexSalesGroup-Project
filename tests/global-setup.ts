// Runs once before all tests: rebuilds the reflex_test database from the committed migrations.
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function setup() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query("select current_database() as name");
    if (rows[0].name !== "reflex_test") throw new Error(`Refusing to reset database "${rows[0].name}"`);
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  } finally {
    await pool.end();
  }
}
