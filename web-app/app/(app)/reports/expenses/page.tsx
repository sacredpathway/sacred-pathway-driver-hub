// =============================================================================
//  /reports/expenses — Carrier HQ Phase W6
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber } from "@/lib/format";
import { resolveRange, rangeToSearch } from "@/lib/reports/range";
import RangePicker from "../RangePicker";
import ReportToolbar from "../ReportToolbar";
import { fetchExpenseReport } from "./data";

export const runtime = "edge";

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const search = rangeToSearch(range);

  const supabase = await createClient();
  const report = await fetchExpenseReport(supabase, range);

  const avgFuelPpg = report.rows.find((r) => r.category === "fuel")?.avg_price_per_gallon ?? null;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expense report</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Category totals, fuel gallons + weighted average cost per gallon,
            DEF totals.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← All reports
        </Link>
      </header>

      <RangePicker actionPath="/reports/expenses" range={range} />

      <ReportToolbar
        csvHref={`/reports/expenses/csv?${search}`}
        printHref={`/reports/expenses/print?${search}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Tile label="Entries"          value={formatNumber(report.totals.count)} />
        <Tile label="Total spend"      value={formatCurrency(report.totals.total)} accent />
        <Tile label="Fuel gallons"     value={formatNumber(report.totals.gallons)} />
        <Tile label="Avg fuel $/gal"   value={avgFuelPpg != null ? formatCurrency(avgFuelPpg) : "—"} />
        <Tile label="DEF total"        value={formatCurrency(report.totals.def_total)} />
      </div>

      {report.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-sp-card/50 p-10 text-center text-sm text-sp-textSecondary">
          No expenses in this range.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Entries</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Gallons</th>
                <th className="px-3 py-2 text-right">Avg $/gal</th>
                <th className="px-3 py-2 text-right">DEF total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {report.rows.map((r) => (
                <tr key={r.category} className="hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-sp-textPrimary">{labelize(r.category)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatNumber(r.count)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-sp-danger">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">
                    {r.gallons != null ? formatNumber(r.gallons) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">
                    {r.avg_price_per_gallon != null ? formatCurrency(r.avg_price_per_gallon) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">
                    {r.def_total != null ? formatCurrency(r.def_total) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-sp-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </div>
      <div
        className={
          "mt-1 text-lg font-bold tracking-tight " +
          (accent ? "text-sp-gold" : "text-sp-textPrimary")
        }
      >
        {value}
      </div>
    </div>
  );
}

function labelize(s: string): string {
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
