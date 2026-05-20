// =============================================================================
//  /reports/revenue/print — Carrier HQ Phase W6
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { fetchReportBranding } from "@/lib/reports/branding";
import { fetchRevenueReport } from "../data";
import PrintShell from "../../PrintShell";
import { formatCurrency, formatNumber } from "@/lib/format";

export const runtime = "edge";

export default async function RevenuePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [report, branding] = await Promise.all([
    fetchRevenueReport(supabase, range),
    fetchReportBranding(supabase, user!.id),
  ]);

  const avgRev = report.totals.load_count > 0
    ? report.totals.revenue / report.totals.load_count
    : 0;
  const rpm = report.totals.miles > 0
    ? report.totals.revenue / report.totals.miles
    : 0;

  return (
    <PrintShell
      title="Revenue Report"
      subtitle="Per-broker loads, miles, revenue, average rate"
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      rangeLabel={`${range.from} → ${range.to}`}
    >
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Carrier totals
        </h2>
        <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
          <Tile label="Brokers"      value={formatNumber(report.totals.brokers)} />
          <Tile label="Loads"        value={formatNumber(report.totals.load_count)} />
          <Tile label="Miles"        value={formatNumber(report.totals.miles)} />
          <Tile label="Revenue"      value={formatCurrency(report.totals.revenue)} />
          <Tile label="Avg rev/load" value={formatCurrency(avgRev)} />
          <Tile label="Revenue / mi" value={formatCurrency(rpm)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Per broker
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-left">
              <th className="px-2 py-1">Broker</th>
              <th className="px-2 py-1 text-right">Loads</th>
              <th className="px-2 py-1 text-right">Miles</th>
              <th className="px-2 py-1 text-right">Revenue</th>
              <th className="px-2 py-1 text-right">Avg/load</th>
              <th className="px-2 py-1 text-right">$/mi</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.broker_name} className="border-b border-black/10">
                <td className="px-2 py-1 font-medium">{r.broker_name}</td>
                <td className="px-2 py-1 text-right">{formatNumber(r.load_count)}</td>
                <td className="px-2 py-1 text-right">{formatNumber(r.miles)}</td>
                <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.revenue)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(r.avg_revenue)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(r.rev_per_mile)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PrintShell>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/15 px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-black/50">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
