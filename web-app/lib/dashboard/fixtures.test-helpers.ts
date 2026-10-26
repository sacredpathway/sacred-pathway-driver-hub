// Test-only row builder. Lives beside the tests; never imported by app code.
import type { DashboardLoad } from "./loadState";

let n = 0;
export function load(p: Partial<DashboardLoad> = {}): DashboardLoad {
  n += 1;
  return {
    id: p.id ?? `load-${n}`,
    load_number: p.load_number ?? `L${n}`,
    driver_id: p.driver_id === undefined ? "drv-1" : p.driver_id,
    broker_name: p.broker_name ?? null,
    origin: p.origin ?? "Tulsa, OK",
    destination: p.destination ?? "Dallas, TX",
    pickup_date: p.pickup_date === undefined ? null : p.pickup_date,
    delivery_date: p.delivery_date === undefined ? null : p.delivery_date,
    status: p.status === undefined ? "assigned" : p.status,
    total_revenue: p.total_revenue === undefined ? 1000 : p.total_revenue,
    total_miles: p.total_miles === undefined ? 500 : p.total_miles,
    created_at: p.created_at ?? "2026-09-01T12:00:00Z",
  };
}
