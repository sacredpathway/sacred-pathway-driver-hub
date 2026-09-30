// =============================================================================
//  Dashboard KPIs — paperwork numbers only (pure, tested, no Supabase)
// -----------------------------------------------------------------------------
//  Every entered load counts as delivered (owner rule — see loadState.ts), so
//  there is no "active" vs "delivered" split. All figures come from the loads
//  and expenses the page read for the selected period:
//
//    • Loads          = number of loads attributed to the period
//    • Gross revenue  = Σ loads.total_revenue  (same set + sum as the Revenue
//                       report; any cancelled amount is surfaced, not hidden)
//    • Miles          = Σ loads.total_miles
//    • Revenue / mile = revenue of loads with miles ÷ their miles
//    • Expenses       = Σ expenses.amount (expenses.created_at rule, unchanged)
//
//  Period attribution is lib/loads/periodDate (delivery → pickup → created).
//  Sums use the Decimal-backed Money type — exact to the cent.
// =============================================================================

import { Money } from "@/lib/money/money";
import { isCancelledLoad, type DashboardLoad } from "./loadState";

export interface DashboardKpiInput {
  /** Loads already restricted to the selected period by the caller's data path. */
  periodLoads: ReadonlyArray<DashboardLoad>;
  /** Expenses already restricted to the selected period by the caller's data path. */
  periodExpenses: ReadonlyArray<{ amount: number | null }>;
}

export interface DashboardKpis {
  loadCount: number;
  grossRevenue: Money;
  cancelledCount: number;
  cancelledRevenue: Money;
  totalMiles: number;
  /** null when no load has miles — never divide by zero or guess. */
  revenuePerMile: Money | null;
  loadsWithMiles: number;
  expenses: Money;
  expenseCount: number;
}

const revenueOf = (l: { total_revenue: number | null }) => Money.fromNumber(l.total_revenue ?? 0);

export function computeDashboardKpis({ periodLoads, periodExpenses }: DashboardKpiInput): DashboardKpis {
  const cancelled = periodLoads.filter(isCancelledLoad);
  const withMiles = periodLoads.filter((l) => (l.total_miles ?? 0) > 0);
  const milesOnMiled = withMiles.reduce((s, l) => s + (l.total_miles ?? 0), 0);
  const revenueOnMiled = Money.sum(withMiles.map(revenueOf));

  return {
    loadCount: periodLoads.length,
    grossRevenue: Money.sum(periodLoads.map(revenueOf)),
    cancelledCount: cancelled.length,
    cancelledRevenue: Money.sum(cancelled.map(revenueOf)),
    totalMiles: periodLoads.reduce((s, l) => s + (l.total_miles ?? 0), 0),
    revenuePerMile: milesOnMiled > 0 ? revenueOnMiled.dividedBy(milesOnMiled).rounded() : null,
    loadsWithMiles: withMiles.length,
    expenses: Money.sum(periodExpenses.map((e) => Money.fromNumber(e.amount ?? 0))),
    expenseCount: periodExpenses.length,
  };
}
