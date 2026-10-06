import { AnalyzeView } from "@/components/AnalyzeView";

export default function AnalyzePage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Single stock analyzer</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Technicals, a 14-day Chronos forecast and FinBERT news sentiment, synthesised into an entry plan by Gemini.
        </p>
      </div>
      <AnalyzeView />
    </>
  );
}
