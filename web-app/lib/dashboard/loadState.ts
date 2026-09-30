// =============================================================================
//  Dashboard load shape + date helpers
// -----------------------------------------------------------------------------
//  Owner rule (2026-09-30): the app does NOT track whether a load is picked up
//  or dropped off. Once a load's paperwork is entered it counts as delivered,
//  and the dashboard only calculates what is on the paperwork (rate, miles,
//  dates, driver). Load status is therefore NOT used for any dashboard figure.
//
//  The single exception is `cancelled`: a cancelled load is not work that was
//  hauled, so it is never flagged for missing paperwork. (Revenue totals keep
//  the existing report behaviour and surface any cancelled amount instead.)
// =============================================================================

import type { Load } from "@/lib/supabase/types";
import { isCancelledStatus } from "@/lib/loads/status";

export type DashboardLoad = Pick<
  Load,
  | "id"
  | "load_number"
  | "driver_id"
  | "broker_name"
  | "origin"
  | "destination"
  | "pickup_date"
  | "delivery_date"
  | "status"
  | "total_revenue"
  | "total_miles"
  | "created_at"
>;

/** "YYYY-MM-DD" (UTC) for a Date — same convention as lib/reports/range.ts. */
export function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" `days` before/after `ymd` (UTC calendar math). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return utcYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

export function isCancelledLoad(load: Pick<DashboardLoad, "status">): boolean {
  return isCancelledStatus(load.status);
}
