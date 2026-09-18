// Root layout: fonts, page title and the app header shared by every page.
import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const body = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Reflex offers",
  description: "Turn supplier line sheets into offers you can check, correct and export.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-rule bg-sheet">
          <div className="mx-auto flex max-w-6xl items-baseline gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="font-display text-xl font-bold tracking-tight text-navy">
              reflex
            </Link>
            <span className="text-sm text-muted">Supplier offers</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
