// =============================================================================
//  Driver earnings report — shared data fetch + aggregation
// -----------------------------------------------------------------------------
//  Per-driver rollup over the selected date range. Inputs:
//    • loads  (revenue, miles) filtered by pickup_date in range
//    • paystubs/settlements (gross paid + net paid) filtered by check_date
//    • drivers (to surface inactive drivers w/ zero activity if you choose)
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Driver, Load, PayrollUnifiedRow } from "@/lib/supabase/types";
import type { ResolvedRange } from "@/lib/reports/range";

export interface DriverEarningsRow {
  driver_id: string | null;
  driver_name: string;
  worker_type: string | null;
  active: boolean | null;
  load_count: number;
  miles: number;
  revenue: number;
  paystubs: number;
  gross_paid: number;
  net_paid: number;
  /** Revenue per mile across all in-range loads for this driver. */
  rev_per_mile: number;
  /** Net paid as a share of revenue (carrier's split exposure). */
  pay_ratio: number;
}

export interface DriverEarningsReport {
  range: ResolvedRange;
  rows: DriverEarningsRow[];
  totals: {
    drivers: number;
    load_count: number;
    miles: number;
    revenue: number;
    paystubs: number;
    gross_paid: number;
    net_paid: number;
  };
}

export async function fetchDriverEarningsReport(
  supabase: SupabaseClient,
  range: ResolvedRange
): Promise<DriverEarningsReport> {
  const [{ data: driversRaw }, { data: loadsRaw }, { data: paystubsRaw }] =
    await Promise.all([
      supabase
        .from("drivers")
        .select("id, name, worker_type, active"),
      supabase
        .from("loads")
        .select("id, driver_id, total_miles, total_revenue, pickup_date")
        .gte("pickup_date", range.from)
        .lte("pickup_date", range.to),
      supabase
        .from("v_payroll_unified")
        .select("driver_id, gross_earnings, net_pay, check_date, created_at")
        .or(
          `and(check_date.gte.${range.from},check_date.lte.${range.to}),` +
          `and(check_date.is.null,created_at.gte.${range.from}T00:00:00.000Z,created_at.lte.${range.to}T23:59:59.999Z)`
        ),
    ]);

  const drivers = (driversRaw ?? []) as Array<
    Pick<Driver, "id" | "name" | "worker_type" | "active">
  >;
  const loads = (loadsRaw ?? []) as Array<
    Pick<Load, "id" | "driver_id" | "total_miles" | "total_revenue" | "pickup_date">
  >;
  const paystubs = (paystubsRaw ?? []) as Array<
    Pick<PayrollUnifiedRow, "driver_id" | "gross_earnings" | "net_pay">
  >;

  const map = new Map<string, DriverEarningsRow>();
  // Seed with every driver that has either a load or paystub in range,
  // OR is active. (Inactive drivers with no in-range activity are skipped
  // to keep the report focused.)
  function seed(driverId: string | null): DriverEarningsRow {
    const d = driverId ? drivers.find((x) => x.id === driverId) : undefined;
    return {
      driver_id: driverId,
      driver_name: d?.name ?? (driverId ? "Unknown driver" : "Unassigned"),
      worker_type: d?.worker_type ?? null,
      active: d?.active ?? null,
      load_count: 0,
      miles: 0,
      revenue: 0,
      paystubs: 0,
      gross_paid: 0,
      net_paid: 0,
      rev_per_mile: 0,
      pay_ratio: 0,
    };
  }

  function key(driverId: string | null): string {
    return driverId ?? "__none__";
  }

  for (const l of loads) {
    const k = key(l.driver_id);
    if (!map.has(k)) map.set(k, seed(l.driver_id));
    const r = map.get(k)!;
    r.load_count += 1;
    r.miles      += l.total_miles   ?? 0;
    r.revenue    += l.total_revenue ?? 0;
  }
  for (const p of paystubs) {
    const k = key(p.driver_id);
    if (!map.has(k)) map.set(k, seed(p.driver_id));
    const r = map.get(k)!;
    r.paystubs   += 1;
    r.gross_paid += p.gross_earnings ?? 0;
    r.net_paid   += p.net_pay ?? 0;
  }

  for (const r of map.values()) {
    r.rev_per_mile = r.miles > 0 ? r.revenue / r.miles : 0;
    r.pay_ratio    = r.revenue > 0 ? r.net_paid / r.revenue : 0;
  }

  const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);

  const totals = rows.reduce(
    (acc, r) => ({
      drivers:    acc.drivers + 1,
      load_count: acc.load_count + r.load_count,
      miles:      acc.miles + r.miles,
      revenue:    acc.revenue + r.revenue,
      paystubs:   acc.paystubs + r.paystubs,
      gross_paid: acc.gross_paid + r.gross_paid,
      net_paid:   acc.net_paid + r.net_paid,
    }),
    { drivers: 0, load_count: 0, miles: 0, revenue: 0, paystubs: 0, gross_paid: 0, net_paid: 0 }
  );

  return { range, rows, totals };
}
