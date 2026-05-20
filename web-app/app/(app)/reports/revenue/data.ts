// =============================================================================
//  Revenue report — per-broker rollup
// -----------------------------------------------------------------------------
//  Reads `loads` filtered by pickup_date and groups by broker_name (case-
//  insensitive normalization). Uses load.broker_name directly rather than
//  brokers.* so loads without a linked broker row still appear under the
//  string broker name the carrier typed in.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Load } from "@/lib/supabase/types";
import type { ResolvedRange } from "@/lib/reports/range";

export interface RevenueRow {
  broker_name: string;        // canonical display name
  load_count: number;
  miles: number;
  revenue: number;
  avg_revenue: number;
  rev_per_mile: number;
}

export interface RevenueReport {
  range: ResolvedRange;
  rows: RevenueRow[];
  totals: {
    brokers: number;
    load_count: number;
    miles: number;
    revenue: number;
  };
}

export async function fetchRevenueReport(
  supabase: SupabaseClient,
  range: ResolvedRange
): Promise<RevenueReport> {
  const { data: loadsRaw } = await supabase
    .from("loads")
    .select("id, broker_name, total_miles, total_revenue, pickup_date")
    .gte("pickup_date", range.from)
    .lte("pickup_date", range.to);

  const loads = (loadsRaw ?? []) as Array<
    Pick<Load, "id" | "broker_name" | "total_miles" | "total_revenue" | "pickup_date">
  >;

  const map = new Map<string, RevenueRow>();
  for (const l of loads) {
    const rawName = (l.broker_name ?? "Unknown broker").trim();
    const key = rawName.toLowerCase();
    let r = map.get(key);
    if (!r) {
      r = {
        broker_name: rawName,
        load_count: 0,
        miles: 0,
        revenue: 0,
        avg_revenue: 0,
        rev_per_mile: 0,
      };
      map.set(key, r);
    }
    r.load_count += 1;
    r.miles      += l.total_miles   ?? 0;
    r.revenue    += l.total_revenue ?? 0;
  }
  for (const r of map.values()) {
    r.avg_revenue  = r.load_count > 0 ? r.revenue / r.load_count : 0;
    r.rev_per_mile = r.miles > 0 ? r.revenue / r.miles : 0;
  }

  const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);
  const totals = rows.reduce(
    (acc, r) => ({
      brokers:    acc.brokers + 1,
      load_count: acc.load_count + r.load_count,
      miles:      acc.miles + r.miles,
      revenue:    acc.revenue + r.revenue,
    }),
    { brokers: 0, load_count: 0, miles: 0, revenue: 0 }
  );

  return { range, rows, totals };
}
