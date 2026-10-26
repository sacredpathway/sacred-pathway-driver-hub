// =============================================================================
//  /dashboard — Phase A (operations dashboard)
// -----------------------------------------------------------------------------
//  Data only. Presentation lives in DashboardView; every figure is computed by
//  the tested pure modules in lib/dashboard/*. Nothing here fabricates data —
//  a failed or empty read renders an honest empty/error state.
//
//  Preserved from the previous dashboard (Carrier HQ W9 + Sponsored Access):
//    • Outside-driver paywall (free + signed in) — no data reads at all.
//    • Sponsored drivers read through the SECURITY DEFINER
//      `driver_dashboard_data` RPC (same arguments as before).
//    • Carrier admins read tables directly under RLS.
//    • Owner rule (2026-09-30): no pickup/drop-off tracking — every entered
//      load counts as delivered; figures come from the paperwork only.
//    • Period filter (default "All time"); loads attributed by
//      lib/loads/periodDate (delivery → pickup → created); expenses by
//      created_at — both exactly as before.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/reports/range";
import { filterLoadsByRange } from "@/lib/loads/periodDate";
import { resolveAccess } from "@/lib/entitlement/resolver";
import type { ActivityRow } from "@/lib/activity/log";
import PageHeader from "@/components/ui/PageHeader";
import { computeDashboardKpis } from "@/lib/dashboard/kpis";
import { attentionItems, rateConfirmationLoadIds } from "@/lib/dashboard/attention";
import { operationsRows } from "@/lib/dashboard/operations";
import { utcYmd, type DashboardLoad } from "@/lib/dashboard/loadState";
import {
  AUTHORITATIVE_SETTLEMENT_COLUMNS,
  RECENT_SETTLEMENTS_LIMIT,
  recentSettlementViews,
  type AuthoritativeSettlementRow,
} from "@/lib/dashboard/settlements";
import OutsideDriverPaywall from "./OutsideDriverPaywall";
import DashboardView from "./DashboardView";

/** Every column exists in production `loads` (supabase/schema-contract). */
const DASHBOARD_LOAD_COLUMNS =
  "id, load_number, driver_id, broker_name, origin, destination, pickup_date, delivery_date, " +
  "status, total_revenue, total_miles, created_at";

type RpcPayload = {
  ok?: boolean;
  needs_link?: boolean;
  loads?: DashboardLoad[];
  expenses?: Array<{ amount: number | null }>;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const entitlement = await resolveAccess(supabase);

  // Outside drivers see ONLY the paywall card — no table reads.
  if (entitlement.accessLevel === "free" && entitlement.userId) {
    return (
      <section className="space-y-6">
        <PageHeader title="Dashboard" />
        <OutsideDriverPaywall />
      </section>
    );
  }

  const range = resolveRange({ preset: sp.preset ?? "all_time", from: sp.from, to: sp.to });
  const today = utcYmd(new Date());
  const isAllTime = range.preset === "all_time";
  const fromInstant = `${range.from}T00:00:00.000Z`;
  const toInstant = `${range.to}T23:59:59.999Z`;

  const isCarrierAdmin = entitlement.accessLevel === "carrier_admin";
  const isCarrierDriver = entitlement.accessLevel === "carrier_driver";

  let allLoads: DashboardLoad[] = [];
  let periodLoads: DashboardLoad[] = [];
  let periodExpenses: Array<{ amount: number | null }> = [];
  let drivers: Array<{ id: string; name: string; active: boolean | null }> = [];
  let rateConIds: Set<string> | null = null;
  let settlementRows: AuthoritativeSettlementRow[] = [];
  let settlementsError = false;
  let activity: ActivityRow[] = [];
  let driverNeedsLink = false;
  let loadsError = false;

  if (isCarrierDriver) {
    // Period read — identical call to the previous dashboard (revenue/expenses).
    const { data: periodRaw } = await supabase.rpc("driver_dashboard_data", {
      p_from: isAllTime ? null : fromInstant,
      p_to: isAllTime ? null : toInstant,
    });
    const period = (periodRaw ?? {}) as RpcPayload;
    if (period.ok) {
      periodLoads = period.loads ?? [];
      periodExpenses = period.expenses ?? [];
      driverNeedsLink = period.needs_link === true;
    } else {
      loadsError = true;
    }
    // Missing-paperwork check covers the last 30 days regardless of the selected period.
    if (isAllTime) {
      allLoads = periodLoads;
    } else {
      const { data: allRaw } = await supabase.rpc("driver_dashboard_data", { p_from: null, p_to: null });
      const all = (allRaw ?? {}) as RpcPayload;
      allLoads = all.ok ? all.loads ?? [] : [];
    }
    // Drivers can't read the carrier's documents/settlements under RLS, so the
    // rate-confirmation rule and settlements card are admin-only (null = skip).
  } else {
    const expensesQuery = (() => {
      let q = supabase.from("expenses").select("id, amount, created_at");
      if (!isAllTime) q = q.gte("created_at", fromInstant).lte("created_at", toInstant);
      return q.order("created_at", { ascending: false });
    })();

    const [loadsRes, expensesRes, driversRes, docsRes, settlementsRes, activityRes] = await Promise.all([
      supabase.from("loads").select(DASHBOARD_LOAD_COLUMNS).order("created_at", { ascending: false }),
      expensesQuery,
      supabase.from("drivers").select("id, name, active"),
      supabase
        .from("documents")
        .select("load_id, document_type")
        .not("load_id", "is", null)
        .eq("document_type", "rate_confirmation"),
      supabase
        .from("settlements")
        .select(AUTHORITATIVE_SETTLEMENT_COLUMNS)
        .not("engine_version", "is", null)
        .or("is_estimate.is.null,is_estimate.eq.false")
        .order("settlement_period_end", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(RECENT_SETTLEMENTS_LIMIT),
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(8),
    ]);

    loadsError = !!loadsRes.error;
    allLoads = (loadsRes.data ?? []) as unknown as DashboardLoad[];
    // Same attribution as before: all-time = every row (undated included).
    periodLoads = isAllTime ? allLoads : filterLoadsByRange(allLoads, range);
    periodExpenses = (expensesRes.data ?? []) as Array<{ amount: number | null }>;
    drivers = (driversRes.data ?? []) as typeof drivers;
    rateConIds = docsRes.error ? null : rateConfirmationLoadIds((docsRes.data ?? []) as Array<{ load_id: string | null; document_type: string | null }>);
    settlementsError = !!settlementsRes.error;
    settlementRows = (settlementsRes.data ?? []) as unknown as AuthoritativeSettlementRow[];
    activity = (activityRes.data ?? []) as ActivityRow[];
  }

  const driverNameById = new Map(drivers.map((d) => [d.id, d.name]));

  const kpis = computeDashboardKpis({ periodLoads, periodExpenses });
  const attention = attentionItems({
    loads: allLoads,
    today,
    includeDriverAssignment: isCarrierAdmin,
    loadIdsWithRateConfirmation: isCarrierDriver ? null : rateConIds,
  });
  const operations = operationsRows(periodLoads, driverNameById);
  const settlements = recentSettlementViews(settlementRows, driverNameById);
  const activeDrivers = drivers.filter((d) => d.active !== false).length;

  return (
    <DashboardView
      range={range}
      isCarrierAdmin={isCarrierAdmin}
      driverNeedsLink={driverNeedsLink}
      loadsError={loadsError}
      kpis={kpis}
      activeDrivers={isCarrierAdmin ? { active: activeDrivers, total: drivers.length } : null}
      attention={attention}
      operations={operations}
      showDriverColumn={isCarrierAdmin}
      settlements={isCarrierDriver ? null : { rows: settlements, error: settlementsError }}
      activity={isCarrierDriver ? null : activity}
    />
  );
}
