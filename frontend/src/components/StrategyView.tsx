import { Bot, CircleCheck, CircleMinus, CircleX, CircleHelp, Cog } from "lucide-react";
import { Alert, Badge, Card, Stat, cx } from "@/components/ui";
import { fmtMoney, fmtQty } from "@/lib/format";
import type { AnalyzerStrategy, PositionStrategy } from "@/lib/strategy-schema";
import type { StrategyMeta } from "@/lib/types";

const stanceTone: Record<string, "positive" | "negative" | "warning" | "neutral" | "info"> = {
  ACCUMULATE: "positive",
  HOLD: "neutral",
  REVIEW_THESIS: "warning",
  TRIM: "warning",
  EXIT: "negative",
  BUY: "positive",
  ACCUMULATE_GRADUALLY: "info",
  WATCHLIST: "neutral",
  AVOID: "negative",
};

const verdictStyle = {
  POSITIVE: { icon: CircleCheck, className: "text-green-700", label: "Positive" },
  NEUTRAL: { icon: CircleMinus, className: "text-neutral-500", label: "Neutral" },
  NEGATIVE: { icon: CircleX, className: "text-red-700", label: "Negative" },
  UNKNOWN: { icon: CircleHelp, className: "text-neutral-400", label: "Unknown" },
} as const;

const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

type Props =
  | { kind: "position"; strategy: PositionStrategy; meta: StrategyMeta; currency: string | null }
  | { kind: "analyzer"; strategy: AnalyzerStrategy; meta: StrategyMeta; currency: string | null };

export function StrategyView(props: Props) {
  const { strategy, meta, currency } = props;
  const money = (n: number | null | undefined) => fmtMoney(n, currency);

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {props.kind === "position" ? "Long-term view" : "Investment case"}
          <Badge tone={stanceTone[strategy.stance] ?? "neutral"}>{label(strategy.stance)}</Badge>
          <Badge>{label(strategy.confidence)} confidence</Badge>
        </span>
      }
    >
      {meta.source === "rule-based" && (
        <div className="mb-4">
          <Alert tone="warning">{meta.fallbackReason ?? "Gemini was unavailable; showing a rule-based strategy."}</Alert>
        </div>
      )}

      <p className="text-sm leading-relaxed text-neutral-800">{strategy.summary}</p>

      {strategy.scorecard.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {strategy.scorecard.map((row, i) => {
            const v = verdictStyle[row.verdict];
            const Icon = v.icon;
            return (
              <li key={i} className="flex gap-3 px-3 py-2 text-sm">
                <span className={cx("flex w-40 shrink-0 items-center gap-1.5 font-medium", v.className)} title={v.label}>
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="text-neutral-800">{row.area}</span>
                </span>
                <span className="text-neutral-600">{row.note}</span>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-neutral-100 pt-4 sm:grid-cols-4">
        {props.kind === "analyzer" && (
          <>
            <Stat label="Accumulation zone" value={`${money(props.strategy.accumulationZone.low)} – ${money(props.strategy.accumulationZone.high)}`} />
            <Stat label="Max portfolio weight" value={`${props.strategy.maxPortfolioWeightPct}%`} />
          </>
        )}
        <Stat label="Horizon" value={strategy.horizon} />
        <Stat label="Fair value (12–24m)" value={strategy.fairValue ? `${money(strategy.fairValue.low)} – ${money(strategy.fairValue.high)}` : "—"} />
        {props.kind === "position" && <Stat label="Review" value={strategy.reviewTrigger} />}
      </dl>

      {props.kind === "position" ? (
        <Section title="Plan">
          <ol className="space-y-2 text-sm">
            {props.strategy.actions.map((a, i) => (
              <li key={i} className="rounded-md bg-neutral-50 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 font-medium text-neutral-900">
                  <span>{a.action}</span>
                  {a.price != null && <span className="num">@ {money(a.price)}</span>}
                  {a.quantity != null && <span className="num text-neutral-600">× {fmtQty(a.quantity)}</span>}
                </div>
                <p className="mt-0.5 text-neutral-600">{a.rationale}</p>
              </li>
            ))}
          </ol>
        </Section>
      ) : (
        <Section title="Buy in tranches">
          <ol className="space-y-1.5 text-sm">
            {props.strategy.tranches.map((t, i) => (
              <li key={i} className="flex items-baseline gap-3 rounded-md bg-neutral-50 px-3 py-2">
                <span className="num w-12 shrink-0 font-medium text-neutral-900">{t.allocationPct}%</span>
                <span className="num w-28 shrink-0 font-medium">@ {money(t.price)}</span>
                <span className="text-neutral-600">{t.note}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Thesis breaks if">
        <p className="rounded-md border border-red-100 bg-red-50/50 px-3 py-2 text-sm text-neutral-800">
          {strategy.thesisInvalidation.condition}
          {strategy.thesisInvalidation.price != null && <span className="num ml-1 font-medium">({money(strategy.thesisInvalidation.price)})</span>}
        </p>
      </Section>

      {strategy.targets.length > 0 && (
        <Section title="12–24 month levels">
          <ul className="space-y-1 text-sm">
            {strategy.targets.map((t, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-neutral-600">{t.label}</span>
                <span className="num font-medium">{money(t.price)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {props.kind === "analyzer" && props.strategy.rationale.length > 0 && (
        <Section title="Rationale">
          <BulletList items={props.strategy.rationale} />
        </Section>
      )}

      {strategy.risks.length > 0 && (
        <Section title="Risks">
          <BulletList items={strategy.risks} />
        </Section>
      )}

      {props.kind === "analyzer" && <p className="mt-4 text-xs text-neutral-500">Review: {strategy.reviewTrigger}</p>}

      <footer className="mt-5 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <div className="flex items-center gap-1.5">
          {meta.source === "gemini" ? <Bot className="h-3.5 w-3.5" /> : <Cog className="h-3.5 w-3.5" />}
          {meta.source === "gemini" ? `Generated by ${meta.model}` : "Rule-based fallback"}
          {meta.reportId != null && <span>· report #{meta.reportId}</span>}
        </div>
        {meta.attempts.some((a) => !a.ok) && (
          <details className="mt-2">
            <summary className="cursor-pointer hover:text-neutral-800">Model fallback log ({meta.attempts.length} attempts)</summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
              {meta.attempts.map((a, i) => (
                <li key={i} className={a.ok ? "text-green-700" : "text-neutral-600"}>
                  {a.ok ? "✓" : "✗"} {a.model}
                  {a.error ? ` — ${a.error}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-2">Not financial advice. Verify against your own research and consider a qualified adviser.</p>
      </footer>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
      {items.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
    </ul>
  );
}
