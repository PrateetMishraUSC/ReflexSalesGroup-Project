// Database tables, enums and CHECK constraints for offers, lines, source rows, audit events and retry keys.
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { CellSnapshot, CandidateLine } from "@/lib/parse/extract";
import { MAX_QUANTITY, MAX_UNIT_COST_DOLLARS } from "@/lib/rules/config";
import type { Issue } from "@/lib/rules/issues";
import type { OfferTotals } from "@/lib/rules/offer";

export const layoutEnum = pgEnum("layout", ["northstar", "harbor"]);
export const offerStatusEnum = pgEnum("offer_status", ["in_review", "saved"]);
export const lineStatusEnum = pgEnum("line_status", ["included", "excluded", "needs_review"]);
export const decisionEnum = pgEnum("line_decision", ["include", "exclude"]);

export type LineEdits = Partial<Record<"itemCode" | "size" | "quantity" | "unitCost", string | number | null>>;

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    layout: layoutEnum("layout").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sheetName: text("sheet_name").notNull(),
    headerRow: integer("header_row").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().notNull(),
    status: offerStatusEnum("status").notNull().default("in_review"),
    version: integer("version").notNull().default(1),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    savedTotals: jsonb("saved_totals").$type<OfferTotals>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("offers_sha256_idx").on(t.sourceSha256),
    index("offers_created_at_idx").on(t.createdAt),
    check("offers_version_positive", sql`${t.version} >= 1`),
    check("offers_saved_has_totals", sql`${t.status} <> 'saved' OR (${t.savedAt} IS NOT NULL AND ${t.savedTotals} IS NOT NULL)`),
  ],
);

export const sourceRows = pgTable(
  "source_rows",
  {
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    sheetRow: integer("sheet_row").notNull(),
    cells: jsonb("cells").$type<Record<string, CellSnapshot>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.sheetRow] })],
);

export const lines = pgTable(
  "lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    sheetRow: integer("sheet_row").notNull(),
    sourceCol: text("source_col").notNull().default(""),
    itemCode: text("item_code"),
    description: text("description"),
    size: text("size"),
    category: text("category"),
    quantity: integer("quantity"),
    unitCost: numeric("unit_cost", { precision: 12, scale: 4 }),
    retailPrice: numeric("retail_price", { precision: 12, scale: 4 }),
    lineValue: numeric("line_value", { precision: 16, scale: 2 }),
    retailValue: numeric("retail_value", { precision: 16, scale: 2 }),
    supplierTotal: integer("supplier_total"),
    supplierTotalCell: text("supplier_total_cell"),
    status: lineStatusEnum("status").notNull(),
    decision: decisionEnum("decision"),
    excludeReason: text("exclude_reason"),
    issues: jsonb("issues").$type<Issue[]>().notNull().default(sql`'[]'::jsonb`),
    raw: jsonb("raw").$type<CandidateLine["raw"]>().notNull(),
    edits: jsonb("edits").$type<LineEdits>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("lines_offer_row_col_key").on(t.offerId, t.sheetRow, t.sourceCol),
    index("lines_offer_status_row_idx").on(t.offerId, t.status, t.sheetRow, t.sourceCol),
    check("lines_quantity_range", sql`${t.quantity} IS NULL OR ${t.quantity} BETWEEN 0 AND ${sql.raw(String(MAX_QUANTITY))}`),
    check("lines_unit_cost_range", sql`${t.unitCost} IS NULL OR (${t.unitCost} > 0 AND ${t.unitCost} <= ${sql.raw(String(MAX_UNIT_COST_DOLLARS))})`),
    check("lines_retail_price_range", sql`${t.retailPrice} IS NULL OR ${t.retailPrice} >= 0`),
    check("lines_line_value_matches", sql`${t.lineValue} IS NULL OR ${t.lineValue} = ROUND(${t.quantity} * ${t.unitCost}, 2)`),
    check("lines_retail_value_matches", sql`${t.retailValue} IS NULL OR ${t.retailValue} = ROUND(${t.quantity} * ${t.retailPrice}, 2)`),
    check(
      "lines_included_is_complete",
      sql`${t.status} <> 'included' OR (${t.itemCode} IS NOT NULL AND ${t.size} IS NOT NULL AND ${t.quantity} > 0 AND ${t.unitCost} IS NOT NULL AND ${t.lineValue} IS NOT NULL)`,
    ),
    check("lines_excluded_has_reason", sql`${t.status} <> 'excluded' OR ${t.excludeReason} IS NOT NULL`),
  ],
);

export const lineEvents = pgTable(
  "line_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    lineId: uuid("line_id"),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    offerVersion: integer("offer_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("line_events_offer_idx").on(t.offerId, t.createdAt)],
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  requestHash: text("request_hash").notNull(),
  offerId: uuid("offer_id"),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
