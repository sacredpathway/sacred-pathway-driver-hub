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
import DriverProgressCard from "./DriverProgressCard";
import OutsideDriverPaywall from "./OutsideDriverPaywall";
import { resolveAccess } from "@/lib/entitlement/resolver";

export const runtime = "edge";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  // ---------------------------------------------------------------------
  // Entitlement gate (Carrier-Sponsored Driver Access)
  // ---------------------------------------------------------------------
  // Outside drivers — signed in but no carrier sponsorship and no personal
  // subscription — see ONLY the paywall card. Skipping all the supabase
  // queries below also means RLS-restricted tables don't fire empty reads
  // that would just return [].
  const earlyClient = await createClient();
  const earlyEntitlement = await resolveAccess(earlyClient);
  if (earlyEntitlement.accessLevel === "free" && earlyEntitlement.userId) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </header>
        <OutsideDriverPaywall />
      </section>
    );
  }

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
  // -----------------------------------------------------------------------
  // Date-field semantics — must match iOS DashboardView.filterByPeriod which
  // filters loads + expenses by `createdAt`, NOT by pickup_date / receipt_date.
  // See SacredPathway/Views/Dashboard/DashboardView.swift lines 35-39 +
  // filterByPeriod at line 353. For "all time" iOS returns every row (no
  // filter applied), so we omit the gte/lte clauses entirely to include
  // rows with NULL created_at as well as full history.
  //
  // created_at is a TIMESTAMPTZ — compare against full ISO instants so the
  // entire "to" day is inclusive (T23:59:59.999Z).
  // -----------------------------------------------------------------------
  const isAllTime = range.preset === "all_time";
  const fromInstant = `${range.from}T00:00:00.000Z`;
  const toInstant   = `${range.to}T23:59:59.999Z`;

  const loadsQuery = (() => {
    let q = supabase.from("loads").select("*");
    if (!isAllTime) {
      q = q.gte("created_at", fromInstant).lte("created_at", toInstant);
    }
    return q.order("created_at", { ascending: false });
  })();

  const expensesQuery = (() => {
    let q = supabase.from("expenses").select("*");
    if (!isAllTime) {
      q = q.gte("created_at", fromInstant).lte("created_at", toInstant);
    }
    return q.order("created_at", { ascending: false });
  })();

  const [
    { data: loadsRaw },
    { data: expensesRaw },
    { data: driversRaw },
    { data: paystubsRaw },
    { data: activityRaw },
  ] = await Promise.all([
    loadsQuery,
    expensesQuery,
    // Expanded select so DriverProgressCard can show est-pay + truck #
    // without a second round-trip. Scope still respects RLS (own carrier).
    supabase
      .from("drivers")
      .select("id, name, active, pay_percentage, flat_rate, pay_type, truck_number"),
    // Add check_date + created_at + driver_id so DriverProgressCard can
    // attribute paystubs and last-activity timestamps per driver.
    supabase
      .from("paystubs")
      .select("id, status, driver_id, check_date, created_at"),
    supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const loads:    Load[]    = (loadsRaw    ?? []) as Load[];
  const expenses: Expense[] = (expensesRaw ?? []) as Expense[];
  const drivers   = (driversRaw   ?? []) as Array<
    Pick<Driver, "id" | "name" | "active" | "pay_percentage" | "flat_rate" | "pay_type" | "truck_number">
  >;
  const paystubs  = (paystubsRaw  ?? []) as Array<
    Pick<Paystub, "id" | "status" | "driver_id" | "check_date" | "created_at">
  >;
  const activity  = (activityRaw  ?? []) as ActivityRow[];

  // Carrier-Sponsored Driver Access: only carrier admins see the
  // per-driver progress card. Drivers (sponsored or basic) don't need it.
  const entitlement = await resolveAccess(supabase);
  const isCarrierAdmin = entitlement.accessLevel === "carrier_admin";

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

      {/* ---------- Period selector ---------- */}
      {/*
        Chips are the primary control — one-click, zero ceremony. Custom
        date ranges are tucked into a <details> disclosure underneath so
        the dashboard isn't cluttered with a second always-visible card.
        Closed by default; opens on click when the carrier actually needs
        an arbitrary window.
      */}
      <PeriodToggles selected={range.preset} />
      <details className="group rounded-md text-xs print:hidden">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-sp-textSecondary hover:bg-white/5 hover:text-sp-textPrimary">
          <span className="transition-transform group-open:rotate-90">▸</span>
          <span>Custom date range</span>
        </summary>
        <div className="pt-3">
          <PeriodFilter range={range} />
        </div>
      </details>

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

      {/* ---------- Driver progress (carrier admin only) ---------- */}
      {isCarrierAdmin && (
        <DriverProgressCard
          drivers={drivers}
          loads={loads}
          expenses={expenses}
          paystubs={paystubs}
        />
      )}

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
