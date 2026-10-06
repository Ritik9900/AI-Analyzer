import { PortfolioTable } from "@/components/PortfolioTable";

export default function PortfolioPage() {
  return (
    <>
      <PageHeader title="Portfolio" subtitle="Positions, live P/L and AI-assisted position management." />
      <PortfolioTable />
    </>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}
