// =============================================================================
//  Operations overview — which loads the dashboard table shows
// -----------------------------------------------------------------------------
//  Active loads only (lib/dashboard/loadState). Soonest delivery first; loads
//  without a delivery date follow, newest pickup first. Driver names are
//  resolved from the roster the page already read — never invented.
// =============================================================================

import { isActiveLoad, type DashboardLoad } from "./loadState";

export interface OperationsRow {
  load: DashboardLoad;
  driverName: string | null;
}

export const OPERATIONS_LIMIT = 8;

export function operationsRows(
  loads: ReadonlyArray<DashboardLoad>,
  driverNameById: ReadonlyMap<string, string>,
  today: string,
  limit = OPERATIONS_LIMIT,
): { rows: OperationsRow[]; totalActive: number } {
  const active = loads.filter((l) => isActiveLoad(l, today));
  const sorted = [...active].sort((a, b) => {
    const da = a.delivery_date ?? "";
    const db = b.delivery_date ?? "";
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    const pa = a.pickup_date ?? a.created_at ?? "";
    const pb = b.pickup_date ?? b.created_at ?? "";
    return pa === pb ? 0 : pa > pb ? -1 : 1;
  });
  return {
    rows: sorted.slice(0, limit).map((load) => ({
      load,
      driverName: load.driver_id ? driverNameById.get(load.driver_id) ?? null : null,
    })),
    totalActive: active.length,
  };
}
