import type { Metadata } from "next";
import { DiscoverView } from "@/components/DiscoverView";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Discover</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Find the strongest long-term candidates in a sector: screened on quality, valuation, trend and risk, then compared by Gemini.
        </p>
      </div>
      <DiscoverView />
    </>
  );
}
