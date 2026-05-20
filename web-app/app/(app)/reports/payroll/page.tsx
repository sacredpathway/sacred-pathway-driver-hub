// =============================================================================
//  /reports/payroll — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Server component. Pulls paystubs + legacy settlements via fetchPayrollReport
//  (shared with the CSV + Print routes), renders per-driver groups and a
//  totals strip.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { resolveRange, rangeToSearch } from "@/lib/reports/range";
import RangePicker from "../RangePicker";
import ReportToolbar from "../ReportToolbar";
import { fetchPayrollReport } from "./data";

export const runtime = "edge";

export default async function PayrollReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const search = rangeToSearch(range);

  const supabase = await createClient();
  const report = await fetchPayrollReport(supabase, range);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll report</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Web paystubs + legacy iOS settlements in the selected range, grouped
            by driver.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← All reports
        </Link>
      </header>

      <RangePicker actionPath="/reports/payroll" range={range} />

      <ReportToolbar
        csvHref={`/reports/payroll/csv?${search}`}
        printHref={`/reports/payroll/print?${search}`}
      />

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Paystubs"           value={formatNumber(report.totals.count)} />
        <StatTile label="Gross"              value={formatCurrency(report.totals.gross)} />
        <StatTile label="Taxes withheld"     value={formatCurrency(report.totals.taxes)} />
        <StatTile label="Pre-tax deductions" value={formatCurrency(report.totals.pretax)} />
        <StatTile label="Post-tax deductions"value={formatCurrency(report.totals.posttax)} />
        <StatTile label="Settlement items"   value={formatCurrency(report.totals.settlement)} />
        <StatTile label="Net pay"            value={formatCurrency(report.totals.net)} accent />
      </div>

      {report.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-sp-card/50 p-10 text-center text-sm text-sp-textSecondary">
          No paystubs or settlements in this range.
        </div>
      ) : (
        report.groups.map((g) => (
          <section
            key={g.driver_id ?? "__none__"}
            className="space-y-2 rounded-xl border border-white/5 bg-sp-card p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-sp-textPrimary">
                {g.driver_name}
              </h2>
              <div className="text-xs text-sp-textSecondary">
                {g.count} {g.count === 1 ? "paystub" : "paystubs"} ·
                {" "}<span className="text-sp-gold">{formatCurrency(g.net_total)}</span>
                {" "}net
              </div>
            </header>

            <div className="overflow-x-auto rounded-lg border border-white/5">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-sp-cardLight text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
                  <tr>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Check</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Worker</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Taxes</th>
                    <th className="px-3 py-2 text-right">Settlement</th>
                    <th className="px-3 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-sp-card/30">
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-sp-textSecondary">
                        {formatDate(r.pay_period_start)} → {formatDate(r.pay_period_end)}
                      </td>
                      <td className="px-3 py-2 text-sp-textSecondary">{formatDate(r.check_date)}</td>
                      <td className="px-3 py-2 text-sp-textSecondary">
                        {r.source === "paystub" ? "Paystub" : "Settlement"}
                      </td>
                      <td className="px-3 py-2 text-sp-textSecondary">{r.worker_type}</td>
                      <td className="px-3 py-2 text-sp-textSecondary">{r.status ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.gross_earnings)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.total_taxes_withheld)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.total_settlement_deductions)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-sp-gold">{formatCurrency(r.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function StatTile({
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
