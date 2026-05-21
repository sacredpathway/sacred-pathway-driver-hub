// =============================================================================
//  /dashboard — Carrier HQ Phase W9
// -----------------------------------------------------------------------------
//  W1 stat tiles preserved verbatim. Phase W9 adds:
//    • Period filter (reuses W6 resolveRange) — applies to loads + expenses
//      tiles. "All time" is the default so first-visit shows the historical
//      number every existing W1 user already expects.
//    • Active drivers tile — count of drivers.active=true
//    • Pending payroll tile — count of paystubs.status='draft'
//    • Recent activity feed — last 10 rows from activity_log w/ entity links
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StatCard from "@/components/StatCard";
import GustoLinkButton from "@/components/GustoLinkButton";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { resolveRange, RANGE_PRESETS } from "@/lib/reports/range";
import {
  activityHref,
  activityLabel,
  type ActivityRow,
} from "@/lib/activity/log";
import type { Load, Expense, Paystub, Driver } from "@/lib/supabase/types";
import PeriodToggles from "./PeriodToggles";

export const runtime = "edge";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  // Default to "all time" on the dashboard so first-paint matches W1 totals.
  const range = resolveRange({
    preset: sp.preset ?? "all_time",
    from:   sp.from,
    to:     sp.to,
  });

  const supabase = await createClient();

  // -----------------------------------------------------------------------
  // Pull everything in parallel. Loads + expenses filtered by date so the
  // tile values respect the period filter. Drivers / paystubs / activity
  // are scope-wide (the carrier always wants the current driver roster and
  // pending paystub count, not the period-restricted view).
  // -----------------------------------------------------------------------
  const [
    { data: loadsRaw },
    { data: expensesRaw },
    { data: driversRaw },
    { data: paystubsRaw },
    { data: activityRaw },
  ] = await Promise.all([
    supabase
      .from("loads")
      .select("*")
      .gte("pickup_date", range.from)
      .lte("pickup_date", range.to)
      .order("created_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("*")
      .gte("receipt_date", range.from)
      .lte("receipt_date", range.to)
      .order("created_at", { ascending: false }),
    supabase
      .from("drivers")
      .select("id, active"),
    supabase
      .from("paystubs")
      .select("id, status"),
    supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const loads:    Load[]    = (loadsRaw    ?? []) as Load[];
  const expenses: Expense[] = (expensesRaw ?? []) as Expense[];
  const drivers   = (driversRaw   ?? []) as Array<Pick<Driver,  "id" | "active">>;
  const paystubs  = (paystubsRaw  ?? []) as Array<Pick<Paystub, "id" | "status">>;
  const activity  = (activityRaw  ?? []) as ActivityRow[];

  // -- Original W1 metrics ----------------------------------------------
  const totalRevenue  = loads.reduce((s, l) => s + (l.total_revenue ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const netProfit     = totalRevenue - totalExpenses;
  const totalMiles    = loads.reduce((s, l) => s + (l.total_miles ?? 0), 0);
  const profitPerMile = totalMiles > 0 ? netProfit / totalMiles : 0;
  const loadCount     = loads.length;
  const avgRevPerLoad = loadCount > 0 ? totalRevenue / loadCount : 0;

  // -- W9 additions ------------------------------------------------------
  const activeDrivers   = drivers.filter((d) => d.active !== false).length;
  const pendingPayroll  = paystubs.filter((p) => p.status === "draft").length;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <span className="text-xs text-sp-textSecondary">{range.label}</span>
      </header>

      {/* ---------- Quick-pick period chips ---------- */}
      <PeriodToggles selected={range.preset} />

      {/* ---------- Custom period filter (dropdown + from/to + Apply) ---------- */}
      <PeriodFilter range={range} />

      {/* ---------- Original W1 tiles (kept) + W9 additions ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Revenue"             value={formatCurrency(totalRevenue)} tone="gold" />
        <StatCard label="Expenses"            value={formatCurrency(totalExpenses)} tone="bad" />
        <StatCard label="Net Profit"          value={formatCurrency(netProfit)} tone={netProfit >= 0 ? "good" : "bad"} />
        <StatCard label="Loads"               value={formatNumber(loadCount)} />
        <StatCard label="Miles"               value={formatNumber(totalMiles)} />
        <StatCard label="Profit / Mile"       value={formatCurrency(profitPerMile)} tone={profitPerMile >= 0 ? "good" : "bad"} />
        <StatCard label="Avg Revenue / Load"  value={loadCount > 0 ? formatCurrency(avgRevPerLoad) : "—"} />
        <StatCard label="Expenses Logged"     value={formatNumber(expenses.length)} />

        {/* W9 — scope-wide carrier ops tiles */}
        <StatCard
          label="Active Drivers"
          value={formatNumber(activeDrivers)}
          sublabel={`of ${formatNumber(drivers.length)} total`}
          tone={activeDrivers > 0 ? "good" : "neutral"}
        />
        <StatCard
          label="Pending Payroll"
          value={formatNumber(pendingPayroll)}
          sublabel={pendingPayroll > 0 ? "drafts ready to issue" : "no drafts open"}
          tone={pendingPayroll > 0 ? "gold" : "neutral"}
        />
      </div>

      {/* ---------- Quick actions strip ---------- */}
      <section className="flex flex-wrap items-center gap-2">
        <Link
          href="/payroll/new"
          className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          + New paystub
        </Link>
        <Link
          href="/loads/new"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
        >
          + New load
        </Link>
        <Link
          href="/expenses/new"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
        >
          + Log expense
        </Link>
        <Link
          href="/drivers/new"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
        >
          + Add driver
        </Link>
        <Link
          href="/reports"
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-sp-textPrimary hover:bg-white/5"
        >
          Reports
        </Link>
        <GustoLinkButton variant="button" />
      </section>

      {/* ---------- Recent activity ---------- */}
      <RecentActivity rows={activity} />

      <p className="text-xs text-sp-textSecondary">
        Driver Hub Carrier HQ — drivers and payroll edits live here on the web.
        Smart Scan and the on-the-road workflow live in the iPhone app.
      </p>
    </section>
  );
}

// =============================================================================
//  Period filter — GET-form, shareable URLs, no client JS
// =============================================================================

function PeriodFilter({ range }: { range: ReturnType<typeof resolveRange> }) {
  return (
    <form
      method="get"
      action="/dashboard"
      className="rounded-xl border border-white/5 bg-sp-card p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Period
          </span>
          <select
            name="preset"
            defaultValue={range.preset}
            className="rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            From
          </span>
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            To
          </span>
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          Apply
        </button>
        <p className="ml-auto text-[11px] text-sp-textSecondary">
          Period applies to Revenue, Expenses, Loads, and Miles tiles.
          Drivers + Pending Payroll are scope-wide.
        </p>
      </div>
    </form>
  );
}

// =============================================================================
//  Recent activity — last 10 from activity_log
// =============================================================================

function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-white/10 bg-sp-card/40 p-6">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Recent activity</h2>
        <p className="mt-2 text-xs text-sp-textSecondary">
          No activity logged yet. As you create loads, drivers, paystubs, or
          documents from the web, they&apos;ll show up here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/5 bg-sp-card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Recent activity</h2>
        <span className="text-xs text-sp-textSecondary">last {rows.length}</span>
      </header>
      <ul className="divide-y divide-white/5">
        {rows.map((r) => {
          const href = activityHref(r);
          const label = activityLabel(r);
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          const amount = typeof meta.amount === "number" ? meta.amount : null;
          return (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1 truncate">
                {href ? (
                  <Link href={href} className="text-sp-textPrimary hover:text-sp-gold">
                    {label}
                  </Link>
                ) : (
                  <span className="text-sp-textPrimary">{label}</span>
                )}
                {amount !== null && (
                  <span className="ml-2 text-xs text-sp-gold">
                    {formatCurrency(amount)}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs text-sp-textSecondary">
                {formatDate(r.created_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
