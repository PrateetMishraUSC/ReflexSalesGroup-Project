-- Initial schema: offers, source rows, lines with CHECK constraints, line events and retry keys.
CREATE TYPE "public"."line_decision" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."layout" AS ENUM('northstar', 'harbor');--> statement-breakpoint
CREATE TYPE "public"."line_status" AS ENUM('included', 'excluded', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('in_review', 'saved');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"offer_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"line_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"offer_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"sheet_row" integer NOT NULL,
	"source_col" text DEFAULT '' NOT NULL,
	"item_code" text,
	"description" text,
	"size" text,
	"category" text,
	"quantity" integer,
	"unit_cost" numeric(12, 4),
	"retail_price" numeric(12, 4),
	"line_value" numeric(16, 2),
	"retail_value" numeric(16, 2),
	"supplier_total" integer,
	"supplier_total_cell" text,
	"status" "line_status" NOT NULL,
	"decision" "line_decision",
	"exclude_reason" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lines_offer_row_col_key" UNIQUE("offer_id","sheet_row","source_col"),
	CONSTRAINT "lines_quantity_range" CHECK ("lines"."quantity" IS NULL OR "lines"."quantity" BETWEEN 0 AND 1000000),
	CONSTRAINT "lines_unit_cost_range" CHECK ("lines"."unit_cost" IS NULL OR ("lines"."unit_cost" > 0 AND "lines"."unit_cost" <= 100000)),
	CONSTRAINT "lines_retail_price_range" CHECK ("lines"."retail_price" IS NULL OR "lines"."retail_price" >= 0),
	CONSTRAINT "lines_line_value_matches" CHECK ("lines"."line_value" IS NULL OR "lines"."line_value" = ROUND("lines"."quantity" * "lines"."unit_cost", 2)),
	CONSTRAINT "lines_retail_value_matches" CHECK ("lines"."retail_value" IS NULL OR "lines"."retail_value" = ROUND("lines"."quantity" * "lines"."retail_price", 2)),
	CONSTRAINT "lines_included_is_complete" CHECK ("lines"."status" <> 'included' OR ("lines"."item_code" IS NOT NULL AND "lines"."size" IS NOT NULL AND "lines"."quantity" > 0 AND "lines"."unit_cost" IS NOT NULL AND "lines"."line_value" IS NOT NULL)),
	CONSTRAINT "lines_excluded_has_reason" CHECK ("lines"."status" <> 'excluded' OR "lines"."exclude_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"layout" "layout" NOT NULL,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"sheet_name" text NOT NULL,
	"header_row" integer NOT NULL,
	"headers" jsonb NOT NULL,
	"status" "offer_status" DEFAULT 'in_review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"saved_at" timestamp with time zone,
	"saved_totals" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_version_positive" CHECK ("offers"."version" >= 1),
	CONSTRAINT "offers_saved_has_totals" CHECK ("offers"."status" <> 'saved' OR ("offers"."saved_at" IS NOT NULL AND "offers"."saved_totals" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "source_rows" (
	"offer_id" uuid NOT NULL,
	"sheet_row" integer NOT NULL,
	"cells" jsonb NOT NULL,
	CONSTRAINT "source_rows_offer_id_sheet_row_pk" PRIMARY KEY("offer_id","sheet_row")
);
--> statement-breakpoint
ALTER TABLE "line_events" ADD CONSTRAINT "line_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_rows" ADD CONSTRAINT "source_rows_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_events_offer_idx" ON "line_events" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "lines_offer_status_row_idx" ON "lines" USING btree ("offer_id","status","sheet_row","source_col");--> statement-breakpoint
CREATE INDEX "offers_sha256_idx" ON "offers" USING btree ("source_sha256");--> statement-breakpoint
CREATE INDEX "offers_created_at_idx" ON "offers" USING btree ("created_at");