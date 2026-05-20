// =============================================================================
//  /reports/expenses/print — Carrier HQ Phase W6
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { fetchReportBranding } from "@/lib/reports/branding";
import { fetchExpenseReport } from "../data";
import PrintShell from "../../PrintShell";
import { formatCurrency, formatNumber } from "@/lib/format";

export const runtime = "edge";

export default async function ExpensePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [report, branding] = await Promise.all([
    fetchExpenseReport(supabase, range),
    fetchReportBranding(supabase, user!.id),
  ]);

  const avgFuel = report.rows.find((r) => r.category === "fuel")?.avg_price_per_gallon ?? null;

  return (
    <PrintShell
      title="Expense Report"
      subtitle="Category totals, fuel costs, DEF"
      companyName={branding.companyName}
      logoUrl={branding.logoUrl}
      rangeLabel={`${range.from} → ${range.to}`}
    >
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Carrier totals
        </h2>
        <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-5">
          <Tile label="Entries"        value={formatNumber(report.totals.count)} />
          <Tile label="Total spend"    value={formatCurrency(report.totals.total)} />
          <Tile label="Fuel gallons"   value={formatNumber(report.totals.gallons)} />
          <Tile label="Avg fuel $/gal" value={avgFuel != null ? formatCurrency(avgFuel) : "—"} />
          <Tile label="DEF total"      value={formatCurrency(report.totals.def_total)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-black/60">
          Per category
        </h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-left">
              <th className="px-2 py-1">Category</th>
              <th className="px-2 py-1 text-right">Entries</th>
              <th className="px-2 py-1 text-right">Total</th>
              <th className="px-2 py-1 text-right">Gallons</th>
              <th className="px-2 py-1 text-right">Avg $/gal</th>
              <th className="px-2 py-1 text-right">DEF total</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.category} className="border-b border-black/10">
                <td className="px-2 py-1 font-medium">{labelize(r.category)}</td>
                <td className="px-2 py-1 text-right">{formatNumber(r.count)}</td>
                <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.total)}</td>
                <td className="px-2 py-1 text-right">{r.gallons != null ? formatNumber(r.gallons) : "—"}</td>
                <td className="px-2 py-1 text-right">
                  {r.avg_price_per_gallon != null ? formatCurrency(r.avg_price_per_gallon) : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  {r.def_total != null ? formatCurrency(r.def_total) : "—"}
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

function labelize(s: string): string {
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
