// =============================================================================
//  Expense report — per-category rollup with fuel-specific extras
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Expense } from "@/lib/supabase/types";
import type { ResolvedRange } from "@/lib/reports/range";

export interface ExpenseCategoryRow {
  category: string;
  count: number;
  total: number;
  /** Only meaningful for fuel rows. */
  gallons: number | null;
  /** Only meaningful for fuel rows. */
  def_total: number | null;
  /** Only meaningful for fuel rows: weighted average $/gal. */
  avg_price_per_gallon: number | null;
}

export interface ExpenseReport {
  range: ResolvedRange;
  rows: ExpenseCategoryRow[];
  totals: {
    count: number;
    total: number;
    gallons: number;
    def_total: number;
  };
}

export async function fetchExpenseReport(
  supabase: SupabaseClient,
  range: ResolvedRange
): Promise<ExpenseReport> {
  // Same date semantics as documents filter: prefer receipt_date, fall back
  // to created_at when the user didn't supply one.
  const { data: rawA } = await supabase
    .from("expenses")
    .select("*")
    .gte("receipt_date", range.from)
    .lte("receipt_date", range.to);

  const { data: rawB } = await supabase
    .from("expenses")
    .select("*")
    .is("receipt_date", null)
    .gte("created_at", `${range.from}T00:00:00.000Z`)
    .lte("created_at", `${range.to}T23:59:59.999Z`);

  const expenses = ([...(rawA ?? []), ...(rawB ?? [])] as Expense[]);

  const map = new Map<string, ExpenseCategoryRow>();
  for (const e of expenses) {
    const key = (e.category ?? "other").toLowerCase();
    let r = map.get(key);
    if (!r) {
      r = {
        category: key,
        count: 0,
        total: 0,
        gallons: null,
        def_total: null,
        avg_price_per_gallon: null,
      };
      map.set(key, r);
    }
    r.count += 1;
    r.total += e.amount ?? 0;
    if (key === "fuel") {
      if (r.gallons === null) r.gallons = 0;
      if (r.def_total === null) r.def_total = 0;
      r.gallons    += e.gallons ?? 0;
      r.def_total  += e.def_total ?? 0;
    }
  }

  // Weighted avg fuel price after the loop so it's a single division.
  const fuelRow = map.get("fuel");
  if (fuelRow && fuelRow.gallons && fuelRow.gallons > 0) {
    fuelRow.avg_price_per_gallon = fuelRow.total / fuelRow.gallons;
  }

  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (acc, r) => ({
      count:     acc.count + r.count,
      total:     acc.total + r.total,
      gallons:   acc.gallons + (r.gallons ?? 0),
      def_total: acc.def_total + (r.def_total ?? 0),
    }),
    { count: 0, total: 0, gallons: 0, def_total: 0 }
  );

  return { range, rows, totals };
}
