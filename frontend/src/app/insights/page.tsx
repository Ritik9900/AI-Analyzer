import type { Metadata } from "next";
import { InsightsView } from "@/components/InsightsView";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Portfolio insights</h1>
        <p className="mt-1 text-sm text-neutral-500">Allocation, profit and loss, performance against the index, and where your risk comes from.</p>
      </div>
      <InsightsView />
    </>
  );
}
