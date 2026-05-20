// =============================================================================
//  /reports/drivers — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Per-driver earnings table. Same RangePicker + ReportToolbar pattern as
//  every other report.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber } from "@/lib/format";
import { resolveRange, rangeToSearch } from "@/lib/reports/range";
import RangePicker from "../RangePicker";
import ReportToolbar from "../ReportToolbar";
import { fetchDriverEarningsReport } from "./data";

export const runtime = "edge";

export default async function DriverEarningsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const search = rangeToSearch(range);

  const supabase = await createClient();
  const report = await fetchDriverEarningsReport(supabase, range);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Driver earnings</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Loads, miles, revenue, gross paid, and net paid per driver in the
            selected range. Sorted by revenue.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← All reports
        </Link>
      </header>

      <RangePicker actionPath="/reports/drivers" range={range} />

      <ReportToolbar
        csvHref={`/reports/drivers/csv?${search}`}
        printHref={`/reports/drivers/print?${search}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Tile label="Drivers"    value={formatNumber(report.totals.drivers)} />
        <Tile label="Loads"      value={formatNumber(report.totals.load_count)} />
        <Tile label="Miles"      value={formatNumber(report.totals.miles)} />
        <Tile label="Revenue"    value={formatCurrency(report.totals.revenue)} accent />
        <Tile label="Paystubs"   value={formatNumber(report.totals.paystubs)} />
        <Tile label="Gross paid" value={formatCurrency(report.totals.gross_paid)} />
        <Tile label="Net paid"   value={formatCurrency(report.totals.net_paid)} />
      </div>

      {report.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-sp-card/50 p-10 text-center text-sm text-sp-textSecondary">
          No driver activity in this range.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2">Worker</th>
                <th className="px-3 py-2 text-right">Loads</th>
                <th className="px-3 py-2 text-right">Miles</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">$/mi</th>
                <th className="px-3 py-2 text-right">Paystubs</th>
                <th className="px-3 py-2 text-right">Gross paid</th>
                <th className="px-3 py-2 text-right">Net paid</th>
                <th className="px-3 py-2 text-right">Pay ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {report.rows.map((r) => (
                <tr key={r.driver_id ?? "__none__"} className="hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-sp-textPrimary">
                    {r.driver_name}
                  </td>
                  <td className="px-3 py-2 text-sp-textSecondary">{r.worker_type ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatNumber(r.load_count)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatNumber(r.miles)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-sp-gold">{formatCurrency(r.revenue)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatCurrency(r.rev_per_mile)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatNumber(r.paystubs)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">{formatCurrency(r.gross_paid)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-sp-textPrimary">{formatCurrency(r.net_paid)}</td>
                  <td className="px-3 py-2 text-right text-sp-textSecondary">
                    {r.revenue > 0 ? `${(r.pay_ratio * 100).toFixed(1)}%` : "—"}
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
