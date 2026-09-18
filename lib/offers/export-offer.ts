// Exports an offer's included lines as CSV, with reference retail beside supplier cost, from one consistent database snapshot.
import { and, asc, eq } from "drizzle-orm";
import { lines } from "@/db/schema";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db/client";
import { decimalToUnits, unitsToDecimal } from "@/lib/rules/money";
import type { OfferTotals } from "@/lib/rules/offer";
import { findOffer, getTotals } from "./read-offer";

export const CSV_HEADER = [
  "Item Code",
  "Description",
  "Size",
  "Category",
  "Quantity",
  "Supplier Unit Cost (USD)",
  "Line Value (USD)",
  "Reference Retail per Piece (USD)",
  "Sheet Row",
];

const TEXT_COLUMNS = new Set([0, 1, 2, 3]);

export type OfferExport = {
  filename: string;
  csv: string;
  lineCount: number;
  offerVersion: number;
  offerStatus: string;
  totals: OfferTotals;
};

export function exportFilename(name: string, date: Date): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "offer"}-${date.toISOString().slice(0, 10)}.csv`;
}

export async function exportOffer(offerId: string, now = new Date()): Promise<OfferExport> {
  return db.transaction(
    async (tx) => {
      const offer = await findOffer(offerId, tx);
      const totals = await getTotals(offerId, tx);
      const rows = await tx
        .select({
          itemCode: lines.itemCode,
          description: lines.description,
          size: lines.size,
          category: lines.category,
          quantity: lines.quantity,
          unitCost: lines.unitCost,
          lineValue: lines.lineValue,
          retailPrice: lines.retailPrice,
          sheetRow: lines.sheetRow,
        })
        .from(lines)
        .where(and(eq(lines.offerId, offerId), eq(lines.status, "included")))
        .orderBy(asc(lines.sheetRow), asc(lines.sourceCol));

      const csv = toCsv(
        CSV_HEADER,
        rows.map((row) => [
          row.itemCode,
          row.description,
          row.size,
          row.category,
          row.quantity,
          unitsToDecimal(decimalToUnits(row.unitCost!)!),
          row.lineValue,
          row.retailPrice === null ? null : unitsToDecimal(decimalToUnits(row.retailPrice)!),
          row.sheetRow,
        ]),
        TEXT_COLUMNS,
      );

      return {
        filename: exportFilename(offer.name, now),
        csv,
        lineCount: rows.length,
        offerVersion: offer.version,
        offerStatus: offer.status,
        totals,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
