// =============================================================================
//  Operational load state for the dashboard — "active" vs "delivered"
// -----------------------------------------------------------------------------
//  Built ONLY on the Phase 0.5 canonical vocabulary (lib/loads/status.ts):
//
//    delivered  = not cancelled AND
//                 ( status group is completed/settled
//                   OR delivery_date is on/before today )
//    active     = not cancelled AND not delivered
//
//  The delivery-date clause mirrors iOS SettlementWorkflowService.isCompleted
//  (assigned/unassigned loads count as complete once their delivery date has
//  arrived) and web `settlementEligibility() === "after_delivery_date"`, so a
//  historical "pending" load whose delivery date is long past is not reported
//  as an active load.
//
//  Cancelled loads are never active and never delivered.
// =============================================================================

import type { Load } from "@/lib/supabase/types";
import { isCancelledStatus, loadStatusGroup } from "@/lib/loads/status";

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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (UTC) for a Date — same convention as lib/reports/range.ts. */
export function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ymdOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, 10);
  return YMD.test(s) ? s : null;
}

export function isDeliveredLoad(load: Pick<DashboardLoad, "status" | "delivery_date">, today: string): boolean {
  if (isCancelledStatus(load.status)) return false;
  const group = loadStatusGroup(load.status);
  if (group === "completed" || group === "settled") return true;
  const delivery = ymdOrNull(load.delivery_date);
  return delivery !== null && delivery <= today;
}

export function isActiveLoad(load: Pick<DashboardLoad, "status" | "delivery_date">, today: string): boolean {
  if (isCancelledStatus(load.status)) return false;
  return !isDeliveredLoad(load, today);
}

export function isSettledLoad(load: Pick<DashboardLoad, "status">): boolean {
  return loadStatusGroup(load.status) === "settled";
}
