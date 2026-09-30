// =============================================================================
//  Dashboard KPIs — pure, tested, no Supabase
// -----------------------------------------------------------------------------
//  Every figure is derived from rows the page already read under RLS. Nothing
//  is estimated, projected or defaulted to a sample value: when there is no
//  data the KPI reports 0 / "—" honestly.
//
//  Financial behaviour is deliberately UNCHANGED from the previous dashboard:
//    • Gross revenue = Σ loads.total_revenue for loads attributed to the
//      period by lib/loads/periodDate (delivery → pickup → created). Same set
//      and same sum as the Revenue report. Cancelled loads are still included
//      there, so the KPI surfaces any cancelled amount instead of hiding it.
//    • Expenses = Σ expenses.amount for rows the page selected for the period
//      (by expenses.created_at — the existing dashboard rule).
//  Sums use the Decimal-backed Money type, so they are exact to the cent.
// =============================================================================

import { Money } from "@/lib/money/money";
import { isCancelledStatus } from "@/lib/loads/status";
import { filterLoadsByRange, loadInRange, type DateRange } from "@/lib/loads/periodDate";
import { isActiveLoad, isDeliveredLoad, type DashboardLoad } from "./loadState";

export interface DashboardKpiInput {
  /** Every load the user can see (not period-filtered). */
  allLoads: ReadonlyArray<DashboardLoad>;
  /** Loads already restricted to the selected period by the caller's data path. */
  periodLoads: ReadonlyArray<DashboardLoad>;
  /** Expenses already restricted to the selected period by the caller's data path. */
  periodExpenses: ReadonlyArray<{ amount: number | null }>;
  /** Monday → today (lib/reports/range "this_week"). */
  thisWeek: DateRange;
  /** "YYYY-MM-DD" (UTC). */
  today: string;
}

export interface DashboardKpis {
  activeLoads: number;
  deliveredThisWeek: number;
  deliveredThisWeekRevenue: Money;
  grossRevenue: Money;
  periodLoadCount: number;
  cancelledInPeriodCount: number;
  cancelledInPeriodRevenue: Money;
  expenses: Money;
  expenseCount: number;
  /** null when no period load has miles — never divide by zero or guess. */
  revenuePerMile: Money | null;
  milesCounted: number;
}

const revenueOf = (l: { total_revenue: number | null }) => Money.fromNumber(l.total_revenue ?? 0);

export function computeDashboardKpis(input: DashboardKpiInput): DashboardKpis {
  const { allLoads, periodLoads, periodExpenses, thisWeek, today } = input;

  const activeLoads = allLoads.filter((l) => isActiveLoad(l, today)).length;

  const deliveredWeek = filterLoadsByRange(allLoads, thisWeek).filter((l) => isDeliveredLoad(l, today));

  const grossRevenue = Money.sum(periodLoads.map(revenueOf));
  const cancelled = periodLoads.filter((l) => isCancelledStatus(l.status));

  const withMiles = periodLoads.filter((l) => (l.total_miles ?? 0) > 0);
  const milesCounted = withMiles.reduce((s, l) => s + (l.total_miles ?? 0), 0);
  const revenueOnMiledLoads = Money.sum(withMiles.map(revenueOf));

  return {
    activeLoads,
    deliveredThisWeek: deliveredWeek.length,
    deliveredThisWeekRevenue: Money.sum(deliveredWeek.map(revenueOf)),
    grossRevenue,
    periodLoadCount: periodLoads.length,
    cancelledInPeriodCount: cancelled.length,
    cancelledInPeriodRevenue: Money.sum(cancelled.map(revenueOf)),
    expenses: Money.sum(periodExpenses.map((e) => Money.fromNumber(e.amount ?? 0))),
    expenseCount: periodExpenses.length,
    revenuePerMile: milesCounted > 0 ? revenueOnMiledLoads.dividedBy(milesCounted).rounded() : null,
    milesCounted,
  };
}

/** Re-exported so callers and tests use the one attribution rule. */
export { loadInRange };
