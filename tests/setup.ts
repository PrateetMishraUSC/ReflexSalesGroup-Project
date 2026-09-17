import { existsSync } from "node:fs";

// Next.js skips .env.local when NODE_ENV=test, so load it directly (CI can set env vars instead).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Point the app's DATABASE_URL at the test database so no test can ever write to reflex_dev or production.
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
