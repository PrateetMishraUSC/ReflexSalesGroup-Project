// Read side of offers: totals from one SQL query, a page of lines, one original sheet row, and recent offers.
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { lines, offers, sourceRows } from "@/db/schema";
import { db } from "@/lib/db/client";
import type { Tx } from "@/lib/db/idempotency";
import { toLineView } from "@/lib/db/rows";
import { NotFoundError } from "@/lib/errors";
import type { LineStatus, OfferTotals } from "@/lib/rules/offer";

export type StatusFilter = LineStatus | "all";

const included = sql`${lines.status} = 'included'`;

export async function getTotals(offerId: string, conn: typeof db | Tx = db): Promise<OfferTotals> {
  const [row] = await conn
    .select({
      includedLines: sql<number>`count(*) filter (where ${included})::int`,
      excludedLines: sql<number>`count(*) filter (where ${lines.status} = 'excluded')::int`,
      needsReviewLines: sql<number>`count(*) filter (where ${lines.status} = 'needs_review')::int`,
      pieces: sql<string>`coalesce(sum(${lines.quantity}) filter (where ${included}), 0)::bigint::text`,
      supplierValue: sql<string>`coalesce(sum(${lines.lineValue}) filter (where ${included}), 0)::numeric(18,2)::text`,
      retailValue: sql<string>`coalesce(sum(${lines.retailValue}) filter (where ${included}), 0)::numeric(18,2)::text`,
    })
    .from(lines)
    .where(eq(lines.offerId, offerId));
  return { ...row, pieces: Number(row.pieces) };
}

export async function findOffer(offerId: string, conn: typeof db | Tx = db) {
  const [offer] = await conn.select().from(offers).where(eq(offers.id, offerId));
  if (!offer) throw new NotFoundError();
  return offer;
}

export async function getOfferPage(offerId: string, options: { status: StatusFilter; page: number; pageSize: number }) {
  const offer = await findOffer(offerId);
  const totals = await getTotals(offerId);
  const filter = options.status === "all" ? eq(lines.offerId, offerId) : and(eq(lines.offerId, offerId), eq(lines.status, options.status));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(lines)
      .where(filter)
      .orderBy(asc(lines.sheetRow), asc(lines.sourceCol))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    db.select({ total: count() }).from(lines).where(filter),
  ]);

  return {
    offer: {
      id: offer.id,
      name: offer.name,
      layout: offer.layout,
      sourceFilename: offer.sourceFilename,
      sheetName: offer.sheetName,
      headerRow: offer.headerRow,
      headers: offer.headers,
      status: offer.status,
      version: offer.version,
      savedAt: offer.savedAt?.toISOString() ?? null,
      savedTotals: offer.savedTotals,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    },
    totals,
    page: { status: options.status, page: options.page, pageSize: options.pageSize, totalLines: total },
    lines: rows.map(toLineView),
  };
}

export type OfferPage = Awaited<ReturnType<typeof getOfferPage>>;

export async function getSourceRow(offerId: string, sheetRow: number) {
  const offer = await findOffer(offerId);
  const [row] = await db
    .select()
    .from(sourceRows)
    .where(and(eq(sourceRows.offerId, offerId), eq(sourceRows.sheetRow, sheetRow)));
  if (!row) throw new NotFoundError("Sheet row");
  return { sheetName: offer.sheetName, headerRow: offer.headerRow, headers: offer.headers, sheetRow, cells: row.cells };
}

export async function listOffers(limit = 50) {
  const rows = await db
    .select({
      id: offers.id,
      name: offers.name,
      layout: offers.layout,
      status: offers.status,
      sourceFilename: offers.sourceFilename,
      createdAt: offers.createdAt,
      includedLines: sql<number>`count(${lines.id}) filter (where ${included})::int`,
      needsReviewLines: sql<number>`count(${lines.id}) filter (where ${lines.status} = 'needs_review')::int`,
      pieces: sql<string>`coalesce(sum(${lines.quantity}) filter (where ${included}), 0)::bigint::text`,
      supplierValue: sql<string>`coalesce(sum(${lines.lineValue}) filter (where ${included}), 0)::numeric(18,2)::text`,
    })
    .from(offers)
    .leftJoin(lines, eq(lines.offerId, offers.id))
    .groupBy(offers.id)
    .orderBy(desc(offers.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, pieces: Number(row.pieces), createdAt: row.createdAt.toISOString() }));
}
