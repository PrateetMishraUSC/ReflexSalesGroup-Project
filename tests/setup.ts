// Loads .env.local and points every test at the reflex_test database.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
