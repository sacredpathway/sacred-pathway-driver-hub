// =============================================================================
//  /reports/cpa — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  CPA-ready P&L summary. Reuses the revenue + expense + payroll data
//  fetchers so the numbers are mathematically identical to those reports.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatNumber } from "@/lib/format";
import { resolveRange, rangeToSearch } from "@/lib/reports/range";
import RangePicker from "../RangePicker";
import ReportToolbar from "../ReportToolbar";
import { fetchCpaReport } from "./data";

export const runtime = "edge";

export default async function CpaReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const search = rangeToSearch(range);

  const supabase = await createClient();
  const report = await fetchCpaReport(supabase, range);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CPA export</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            P&amp;L summary in the format an accountant or tax preparer can use
            directly. Numbers reconcile with the Revenue, Expenses, and Payroll
            reports.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          ← All reports
        </Link>
      </header>

      <RangePicker actionPath="/reports/cpa" range={range} />

      <ReportToolbar
        csvHref={`/reports/cpa/csv?${search}`}
        printHref={`/reports/cpa/print?${search}`}
      />

      {/* Top-of-funnel P&L */}
      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-sp-textPrimary">
          Profit &amp; loss summary
        </h2>
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <Line label="Revenue">{formatCurrency(report.totals.revenue)}</Line>
          <Line label="Total expenses">−{formatCurrency(report.totals.expenses)}</Line>
          <Line label="Operating profit" emphasis tone="gold">
            {formatCurrency(report.totals.operating_profit)}
          </Line>
          <Line label="Driver pay (paystubs)">
            −{formatCurrency(report.totals.paystub_net)}
          </Line>
          <Line label="Carrier net" emphasis tone="good">
            {formatCurrency(report.totals.carrier_net)}
          </Line>
        </dl>
      </div>

      {/* Volume metrics */}
      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-sp-textPrimary">
          Volume
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Line label="Loads">{formatNumber(report.totals.load_count)}</Line>
          <Line label="Miles">{formatNumber(report.totals.miles)}</Line>
          <Line label="Fuel spend">{formatCurrency(report.totals.fuel_total)}</Line>
          <Line label="Paystub gross">{formatCurrency(report.totals.paystub_gross)}</Line>
        </dl>
        <p className="mt-3 text-[11px] text-sp-textSecondary">
          Deductible miles for the IRS standard-mileage method:{" "}
          <span className="font-mono text-sp-textPrimary">
            {formatNumber(report.totals.deductible_miles)}
          </span>{" "}
          mi. Confirm with your CPA whether you&apos;re using actual-expense
          method (deduct fuel + maintenance + depreciation) or standard
          mileage (deduct miles × rate). The web shows both pieces so you can
          decide.
        </p>
      </div>

      {/* Revenue breakdown — top 10 brokers */}
      {report.revenue_by_broker.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-sp-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-sp-textPrimary">
            Top brokers
          </h2>
          <ul className="space-y-1 text-sm">
            {report.revenue_by_broker.slice(0, 10).map((b) => (
              <li
                key={b.broker_name}
                className="flex items-baseline justify-between border-b border-white/5 py-1 text-sp-textSecondary last:border-0"
              >
                <span className="text-sp-textPrimary">{b.broker_name}</span>
                <span>
                  <span className="mr-2 text-xs">
                    {formatNumber(b.load_count)} loads
                  </span>
                  <span className="font-semibold text-sp-gold">
                    {formatCurrency(b.revenue)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Expense breakdown */}
      {report.expenses_by_category.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-sp-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-sp-textPrimary">
            Expenses by category
          </h2>
          <ul className="space-y-1 text-sm">
            {report.expenses_by_category.map((e) => (
              <li
                key={e.category}
                className="flex items-baseline justify-between border-b border-white/5 py-1 text-sp-textSecondary last:border-0"
              >
                <span className="text-sp-textPrimary">{labelize(e.category)}</span>
                <span>
                  <span className="mr-2 text-xs">
                    {formatNumber(e.count)} entries
                  </span>
                  <span className="font-semibold text-sp-danger">
                    {formatCurrency(e.total)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Line({
  label,
  emphasis = false,
  tone = "neutral",
  children,
}: {
  label: string;
  emphasis?: boolean;
  tone?: "neutral" | "gold" | "good";
  children: React.ReactNode;
}) {
  const valueTone =
    tone === "gold" ? "text-sp-gold"
    : tone === "good" ? "text-sp-success"
    : "text-sp-textPrimary";
  return (
    <div
      className={
        "flex items-baseline justify-between rounded-md border border-white/5 bg-sp-cardLight/40 px-3 py-2 " +
        (emphasis ? "font-bold" : "")
      }
    >
      <dt className="text-xs uppercase tracking-wide text-sp-textSecondary">
        {label}
      </dt>
      <dd className={"text-sm " + valueTone}>{children}</dd>
    </div>
  );
}

function labelize(s: string): string {
  return s.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}
