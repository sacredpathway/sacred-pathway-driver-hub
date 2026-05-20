// =============================================================================
//  /reports/cpa/print — Carrier HQ Phase W6
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { fetchReportBranding } from "@/lib/reports/branding";
import { fetchCpaReport } from "../data";
import PrintShell from "../../PrintShell";
import { formatCurrency, formatNumber } from "@/lib/format";

export const runtime = "edge";

export default async function CpaPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [report, branding] = await Promise.all([
    fetchCpaReport(supabase, range),
    fetchReportBranding(supabase, user!.id),
  ]);

  return (
    <PrintShell
      title="CPA Export"
      subtitle="Profit & loss summary"
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      rangeLabel={`${range.from} → ${range.to}`}
    >
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Profit &amp; loss summary
        </h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <Row label="Revenue">{formatCurrency(report.totals.revenue)}</Row>
            <Row label="Total expenses">−{formatCurrency(report.totals.expenses)}</Row>
            <Row label="Operating profit" emphasis>{formatCurrency(report.totals.operating_profit)}</Row>
            <Row label="Driver pay (paystubs)">−{formatCurrency(report.totals.paystub_net)}</Row>
            <Row label="Carrier net" emphasis>{formatCurrency(report.totals.carrier_net)}</Row>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-widest text-black/60">
          Volume
        </h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <Row label="Loads">{formatNumber(report.totals.load_count)}</Row>
            <Row label="Miles">{formatNumber(report.totals.miles)}</Row>
            <Row label="Fuel spend">{formatCurrency(report.totals.fuel_total)}</Row>
            <Row label="Paystub gross">{formatCurrency(report.totals.paystub_gross)}</Row>
            <Row label="Deductible miles (IRS standard)">{formatNumber(report.totals.deductible_miles)}</Row>
          </tbody>
        </table>
      </section>

      {report.revenue_by_broker.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-widest text-black/60">
            Revenue by broker
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
              {report.revenue_by_broker.map((r) => (
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
      )}

      {report.expenses_by_category.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-widest text-black/60">
            Expenses by category
          </h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black/30 text-left">
                <th className="px-2 py-1">Category</th>
                <th className="px-2 py-1 text-right">Entries</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1 text-right">Gallons</th>
                <th className="px-2 py-1 text-right">Avg $/gal</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses_by_category.map((r) => (
                <tr key={r.category} className="border-b border-black/10">
                  <td className="px-2 py-1 font-medium">{labelize(r.category)}</td>
                  <td className="px-2 py-1 text-right">{formatNumber(r.count)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.total)}</td>
                  <td className="px-2 py-1 text-right">{r.gallons != null ? formatNumber(r.gallons) : "—"}</td>
                  <td className="px-2 py-1 text-right">
                    {r.avg_price_per_gallon != null ? formatCurrency(r.avg_price_per_gallon) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </PrintShell>
  );
}

function Row({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <tr className={"border-b border-black/10 " + (emphasis ? "font-bold" : "")}>
      <td className="px-2 py-1 text-black/70">{label}</td>
      <td className="px-2 py-1 text-right">{children}</td>
    </tr>
  );
}

function labelize(s: string): string {
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
