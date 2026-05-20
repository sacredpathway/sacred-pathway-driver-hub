// =============================================================================
//  CPA export — top-level P&L the accountant can drop into a tax return
// -----------------------------------------------------------------------------
//  Composes the three other report fetchers (revenue, expenses, payroll) into
//  one CPA-ready summary. Single source of truth + identical math across
//  the screen view, CSV, and print PDF.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedRange } from "@/lib/reports/range";
import { fetchRevenueReport, type RevenueRow } from "../revenue/data";
import { fetchExpenseReport, type ExpenseCategoryRow } from "../expenses/data";
import { fetchPayrollReport } from "../payroll/data";

export interface CpaReport {
  range: ResolvedRange;
  revenue_by_broker: RevenueRow[];
  expenses_by_category: ExpenseCategoryRow[];
  totals: {
    revenue: number;
    miles: number;
    load_count: number;
    expenses: number;
    fuel_total: number;
    paystub_gross: number;
    paystub_net: number;
    /** revenue - expenses (operating profit before driver pay). */
    operating_profit: number;
    /** revenue - expenses - paystub_net (carrier net after driver pay). */
    carrier_net: number;
    /** Gross deductible miles for the IRS standard-mileage method, if used. */
    deductible_miles: number;
  };
}

export async function fetchCpaReport(
  supabase: SupabaseClient,
  range: ResolvedRange
): Promise<CpaReport> {
  const [revenue, expenses, payroll] = await Promise.all([
    fetchRevenueReport(supabase, range),
    fetchExpenseReport(supabase, range),
    fetchPayrollReport(supabase, range),
  ]);

  const fuelTotal = expenses.rows.find((r) => r.category === "fuel")?.total ?? 0;
  const operatingProfit = revenue.totals.revenue - expenses.totals.total;
  const carrierNet = operatingProfit - payroll.totals.net;

  return {
    range,
    revenue_by_broker: revenue.rows,
    expenses_by_category: expenses.rows,
    totals: {
      revenue:          revenue.totals.revenue,
      miles:            revenue.totals.miles,
      load_count:       revenue.totals.load_count,
      expenses:         expenses.totals.total,
      fuel_total:       fuelTotal,
      paystub_gross:    payroll.totals.gross,
      paystub_net:      payroll.totals.net,
      operating_profit: operatingProfit,
      carrier_net:      carrierNet,
      deductible_miles: revenue.totals.miles,
    },
  };
}
