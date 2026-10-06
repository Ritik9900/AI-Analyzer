import type { Metadata } from "next";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Portfolio Analyzer", template: "%s · Portfolio Analyzer" },
  description: "Long-term portfolio tracking with fundamentals, risk analytics and AI-assisted analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:shadow">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-stretch justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center text-sm font-semibold tracking-tight">
              Portfolio Analyzer
            </Link>
            <NavLinks />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-neutral-500 sm:px-6">
          For informational purposes only. Not financial advice. Model outputs can be wrong; consult a qualified financial adviser before
          trading.
        </footer>
      </body>
    </html>
  );
}
