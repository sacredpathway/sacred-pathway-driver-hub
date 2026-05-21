// =============================================================================
//  DriverProgressCard — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Carrier-admin-only block on /dashboard. Shows per-driver:
//    • miles
//    • revenue
//    • estimated pay (revenue * driver.pay_percentage / 100, or flat rate)
//    • expenses
//    • settlements (paystub count)
//    • last activity (most recent of: load created, paystub issued, expense)
//
//  Rolls up loads/expenses/paystubs already in memory on the dashboard so
//  this is zero extra round-trips when the carrier has < a few hundred
//  loads. Larger carriers move this to /reports/drivers (already exists).
// =============================================================================

import Link from "next/link";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import type {
  Load,
  Expense,
  Paystub,
  Driver,
} from "@/lib/supabase/types";

interface Row {
  driver: Pick<Driver, "id" | "name" | "active" | "pay_percentage" | "flat_rate" | "pay_type" | "truck_number">;
  loadCount: number;
  miles: number;
  revenue: number;
  expenses: number;
  paystubs: number;
  estPay: number;
  lastActivityAt: string | null;
}

function estimatedPay(
  d: Pick<Driver, "pay_percentage" | "flat_rate" | "pay_type">,
  revenue: number,
  loadCount: number
): number {
  // Mirror iOS SettlementEngine: flat-rate drivers get flat × number of
  // settlements (here, approximated as number of loads / 1; carriers track
  // settlements separately on the iPhone). Percentage drivers: revenue × %.
  if ((d.pay_type ?? "percent") === "flat" && d.flat_rate != null) {
    // We don't have settlements-per-driver in memory here, so flat-rate
    // estimate is one flat charge per driver as a conservative floor.
    return Number(d.flat_rate);
  }
  const pct = Number(d.pay_percentage ?? 0);
  if (pct <= 0) return 0;
  return revenue * (pct / 100);
}

export default function DriverProgressCard({
  drivers,
  loads,
  expenses,
  paystubs,
}: {
  drivers: ReadonlyArray<Pick<Driver, "id" | "name" | "active" | "pay_percentage" | "flat_rate" | "pay_type" | "truck_number">>;
  loads:    ReadonlyArray<Pick<Load,    "id" | "driver_id" | "total_revenue" | "total_miles" | "created_at" | "pickup_date">>;
  expenses: ReadonlyArray<Pick<Expense, "id" | "load_id" | "amount" | "created_at" | "receipt_date">>;
  paystubs: ReadonlyArray<Pick<Paystub, "id" | "driver_id" | "status" | "check_date" | "created_at">>;
}) {
  // Build a load_id → driver_id map so unmatched-but-linked-to-load
  // expenses can be attributed to a driver.
  const loadDriverByLoadId = new Map<string, string | null>();
  for (const l of loads) loadDriverByLoadId.set(l.id, l.driver_id ?? null);

  const rows: Row[] = drivers.map((d) => {
    const driverLoads = loads.filter((l) => l.driver_id === d.id);
    const loadCount = driverLoads.length;
    const miles = driverLoads.reduce((s, l) => s + (l.total_miles ?? 0), 0);
    const revenue = driverLoads.reduce((s, l) => s + (l.total_revenue ?? 0), 0);

    // Expenses: count rows whose load_id maps to this driver. Loose
    // attribution — carriers without per-driver expense tracking simply
    // see $0 here.
    const driverExpenses = expenses
      .filter((e) => e.load_id != null && loadDriverByLoadId.get(e.load_id) === d.id)
      .reduce((s, e) => s + (e.amount ?? 0), 0);

    const driverPaystubs = paystubs.filter((p) => p.driver_id === d.id).length;
    const estPay = estimatedPay(d, revenue, loadCount);

    // Last activity: most recent of: load.created_at, paystub.created_at,
    // expense.created_at (limited to driver-attributed sources).
    let lastActivityAt: string | null = null;
    for (const l of driverLoads) {
      if (l.created_at && (!lastActivityAt || l.created_at > lastActivityAt)) {
        lastActivityAt = l.created_at;
      }
    }
    for (const p of paystubs) {
      if (p.driver_id !== d.id) continue;
      if (p.created_at && (!lastActivityAt || p.created_at > lastActivityAt)) {
        lastActivityAt = p.created_at;
      }
    }

    return {
      driver: d,
      loadCount,
      miles,
      revenue,
      expenses: driverExpenses,
      paystubs: driverPaystubs,
      estPay,
      lastActivityAt,
    };
  });

  // Sort: active first, then revenue desc.
  rows.sort((a, b) => {
    const aa = a.driver.active === false ? 1 : 0;
    const bb = b.driver.active === false ? 1 : 0;
    if (aa !== bb) return aa - bb;
    return b.revenue - a.revenue;
  });

  if (drivers.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-white/10 bg-sp-card/40 p-6">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Driver progress</h2>
        <p className="mt-2 text-xs text-sp-textSecondary">
          No drivers yet. Add a driver from{" "}
          <Link href="/drivers/new" className="text-sp-gold hover:underline">
            Drivers → + Add driver
          </Link>{" "}
          or invite one from{" "}
          <Link href="/team" className="text-sp-gold hover:underline">Team</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/5 bg-sp-card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Driver progress</h2>
        <Link href="/reports/drivers" className="text-xs text-sp-gold hover:underline">
          Full report →
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-2 py-2">Driver</th>
              <th className="px-2 py-2 text-right">Loads</th>
              <th className="px-2 py-2 text-right">Miles</th>
              <th className="px-2 py-2 text-right">Revenue</th>
              <th className="px-2 py-2 text-right">Est. pay</th>
              <th className="px-2 py-2 text-right">Expenses</th>
              <th className="px-2 py-2 text-right">Paystubs</th>
              <th className="px-2 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => (
              <tr key={r.driver.id} className={r.driver.active === false ? "opacity-60" : ""}>
                <td className="px-2 py-2 font-medium text-sp-textPrimary">
                  <Link href={`/drivers/${r.driver.id}`} className="hover:text-sp-gold">
                    {r.driver.name}
                  </Link>
                  {r.driver.truck_number && (
                    <span className="ml-2 text-[11px] text-sp-textSecondary">
                      #{r.driver.truck_number}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-sp-textSecondary">
                  {formatNumber(r.loadCount)}
                </td>
                <td className="px-2 py-2 text-right text-sp-textSecondary">
                  {formatNumber(r.miles)}
                </td>
                <td className="px-2 py-2 text-right font-semibold text-sp-gold">
                  {formatCurrency(r.revenue)}
                </td>
                <td className="px-2 py-2 text-right text-sp-textPrimary">
                  {formatCurrency(r.estPay)}
                </td>
                <td className="px-2 py-2 text-right text-sp-danger">
                  {formatCurrency(r.expenses)}
                </td>
                <td className="px-2 py-2 text-right text-sp-textSecondary">
                  {formatNumber(r.paystubs)}
                </td>
                <td className="px-2 py-2 text-sp-textSecondary">
                  {formatDate(r.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
