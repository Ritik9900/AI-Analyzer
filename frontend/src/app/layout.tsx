import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Search, Settings } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio Analyzer",
  description: "Portfolio tracking with technical, ML and AI-assisted analysis",
};

const nav = [
  { href: "/", label: "Portfolio", icon: Briefcase },
  { href: "/analyze", label: "Analyze", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <span className="text-sm font-semibold tracking-tight">Portfolio Analyzer</span>
            <nav className="flex gap-6 text-sm text-neutral-600">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="flex items-center gap-1.5 hover:text-neutral-900">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-neutral-500">
          For informational purposes only. Not financial advice. Model outputs can be wrong; consult a
          qualified financial adviser before trading.
        </footer>
      </body>
    </html>
  );
}
