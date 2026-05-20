// =============================================================================
//  /reports/drivers/print — Carrier HQ Phase W6
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { fetchReportBranding } from "@/lib/reports/branding";
import { fetchDriverEarningsReport } from "../data";
import PrintShell from "../../PrintShell";
import { formatCurrency, formatNumber } from "@/lib/format";

export const runtime = "edge";

export default async function DriverEarningsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [report, branding] = await Promise.all([
    fetchDriverEarningsReport(supabase, range),
    fetchReportBranding(supabase, user!.id),
  ]);

  return (
    <PrintShell
      title="Driver Earnings"
      subtitle="Loads, miles, revenue, gross paid, net paid per driver"
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      rangeLabel={`${range.from} → ${range.to}`}
    >
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Carrier totals
        </h2>
        <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-7">
          <Tile label="Drivers"    value={formatNumber(report.totals.drivers)} />
          <Tile label="Loads"      value={formatNumber(report.totals.load_count)} />
          <Tile label="Miles"      value={formatNumber(report.totals.miles)} />
          <Tile label="Revenue"    value={formatCurrency(report.totals.revenue)} />
          <Tile label="Paystubs"   value={formatNumber(report.totals.paystubs)} />
          <Tile label="Gross paid" value={formatCurrency(report.totals.gross_paid)} />
          <Tile label="Net paid"   value={formatCurrency(report.totals.net_paid)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Per driver
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-left">
              <th className="px-2 py-1">Driver</th>
              <th className="px-2 py-1">Worker</th>
              <th className="px-2 py-1 text-right">Loads</th>
              <th className="px-2 py-1 text-right">Miles</th>
              <th className="px-2 py-1 text-right">Revenue</th>
              <th className="px-2 py-1 text-right">$/mi</th>
              <th className="px-2 py-1 text-right">Gross paid</th>
              <th className="px-2 py-1 text-right">Net paid</th>
              <th className="px-2 py-1 text-right">Pay %</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.driver_id ?? "__none__"} className="border-b border-black/10">
                <td className="px-2 py-1 font-medium">{r.driver_name}</td>
                <td className="px-2 py-1">{r.worker_type ?? "—"}</td>
                <td className="px-2 py-1 text-right">{formatNumber(r.load_count)}</td>
                <td className="px-2 py-1 text-right">{formatNumber(r.miles)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(r.revenue)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(r.rev_per_mile)}</td>
                <td className="px-2 py-1 text-right">{formatCurrency(r.gross_paid)}</td>
                <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.net_paid)}</td>
                <td className="px-2 py-1 text-right">
                  {r.revenue > 0 ? `${(r.pay_ratio * 100).toFixed(1)}%` : "—"}
                </td>
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
