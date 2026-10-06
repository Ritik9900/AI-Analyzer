"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, ChartPie, Search, Settings } from "lucide-react";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/", label: "Portfolio", icon: Briefcase },
  { href: "/insights", label: "Insights", icon: ChartPie },
  { href: "/analyze", label: "Analyze", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full items-stretch gap-1 text-sm sm:gap-4">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cx(
              "flex items-center gap-1.5 border-b-2 px-1.5 transition-colors",
              active ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-600 hover:text-neutral-900",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
