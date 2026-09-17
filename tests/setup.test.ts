import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/lib/db/client";

describe("project setup", () => {
  it("has the three supplied spreadsheets as fixtures", () => {
    for (const file of ["01-northstar-line-sheet.xlsx", "02-harbor-size-grid.xlsx", "03-northstar-5000-rows.xlsx"]) {
      expect(existsSync(`fixtures/${file}`)).toBe(true);
    }
  });

  it("connects to the test database, never the dev database", async () => {
    const result = await db.execute(sql`select current_database() as name`);
    expect(result.rows[0].name).toBe("reflex_test");
  });

  afterAll(() => pool.end());
});
