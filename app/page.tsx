// Home page: upload a supplier line sheet and see recent offers, read fresh from the database on every request.
import { connection } from "next/server";
import { listOffers } from "@/lib/offers/read-offer";
import { RecentOffers } from "./_components/recent-offers";
import { UploadPanel } from "./_components/upload-panel";

export default async function Home() {
  await connection();
  const offers = await listOffers();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-4xl">
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-balance text-navy sm:text-5xl">
          Turn a supplier line sheet into an <span className="text-brand">offer</span>
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Upload the spreadsheet as the supplier sent it. Questionable rows are flagged for you to correct or leave out, and every decision is saved.
        </p>
      </div>

      <div className="mt-8 max-w-3xl">
        <UploadPanel />
      </div>

      <RecentOffers offers={offers} />
    </main>
  );
}
