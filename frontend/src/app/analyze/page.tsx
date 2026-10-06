import { AnalyzeView } from "@/components/AnalyzeView";

export default function AnalyzePage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Single stock analyzer</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Long-term investment case: business quality, valuation, multi-year trend and risk, with a staggered buying plan from Gemini.
        </p>
      </div>
      <AnalyzeView />
    </>
  );
}
