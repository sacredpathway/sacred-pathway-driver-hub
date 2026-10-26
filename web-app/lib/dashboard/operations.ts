// =============================================================================
//  Recent loads — newest paperwork first (no status, owner rule)
// -----------------------------------------------------------------------------
//  Sorted by the load's period date (delivery → pickup → created), newest
//  first. Driver names come from the roster the page read — never invented.
// =============================================================================

import { loadPeriodDate } from "@/lib/loads/periodDate";
import type { DashboardLoad } from "./loadState";

export interface OperationsRow {
  load: DashboardLoad;
  driverName: string | null;
}

export const OPERATIONS_LIMIT = 8;

export function operationsRows(
  loads: ReadonlyArray<DashboardLoad>,
  driverNameById: ReadonlyMap<string, string>,
  limit = OPERATIONS_LIMIT,
): { rows: OperationsRow[]; total: number } {
  const sorted = [...loads].sort((a, b) => {
    const da = loadPeriodDate(a) ?? "";
    const db = loadPeriodDate(b) ?? "";
    if (da !== db) return da > db ? -1 : 1;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    return ca === cb ? 0 : ca > cb ? -1 : 1;
  });
  return {
    rows: sorted.slice(0, limit).map((load) => ({
      load,
      driverName: load.driver_id ? driverNameById.get(load.driver_id) ?? null : null,
    })),
    total: loads.length,
  };
}
