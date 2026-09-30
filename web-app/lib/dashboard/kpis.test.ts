import { describe, expect, it } from "vitest";
import { filterLoadsByRange } from "@/lib/loads/periodDate";
import { computeDashboardKpis } from "./kpis";
import { load } from "./fixtures.test-helpers";

const WEEK = { from: "2026-09-28", to: "2026-09-30" };

describe("computeDashboardKpis — paperwork numbers only", () => {
  const loads = [
    load({ id: "a", status: "in_transit", pickup_date: "2026-09-29", delivery_date: "2026-09-30", total_revenue: 2500.1, total_miles: 1000 }),
    load({ id: "b", status: "pending", pickup_date: "2026-09-26", delivery_date: "2026-09-29", total_revenue: 1800.2, total_miles: 600 }),
    load({ id: "c", status: null, pickup_date: "2026-09-28", delivery_date: null, total_revenue: 900, total_miles: 0 }),
    load({ id: "d", status: "settled", pickup_date: "2026-09-20", delivery_date: "2026-09-22", total_revenue: 3000, total_miles: 1200 }),
    load({ id: "f", status: "cancelled", pickup_date: "2026-09-29", delivery_date: "2026-09-30", total_revenue: 700, total_miles: 300 }),
  ];

  it("every entered load counts — status does not change any number", () => {
    const period = filterLoadsByRange(loads, WEEK);
    expect(period.map((l) => l.id).sort()).toEqual(["a", "b", "c", "f"]);
    const k = computeDashboardKpis({ periodLoads: period, periodExpenses: [] });
    expect(k.loadCount).toBe(4);
    expect(k.grossRevenue.toFixed2()).toBe("5900.30");
    expect(k.totalMiles).toBe(1900);
    expect(k.cancelledCount).toBe(1);
    expect(k.cancelledRevenue.toFixed2()).toBe("700.00");

    const renamed = period.map((l) => ({ ...l, status: "assigned" }));
    const k2 = computeDashboardKpis({ periodLoads: renamed, periodExpenses: [] });
    expect(k2.grossRevenue.toFixed2()).toBe(k.grossRevenue.toFixed2());
    expect(k2.totalMiles).toBe(k.totalMiles);
    expect(k2.loadCount).toBe(k.loadCount);
  });

  it("revenue per mile only divides loads that have miles; null when none", () => {
    const k = computeDashboardKpis({ periodLoads: loads, periodExpenses: [] });
    // miled: a 2500.10/1000, b 1800.20/600, d 3000/1200, f 700/300 → 8000.30 / 3100
    expect(k.loadsWithMiles).toBe(4);
    expect(k.revenuePerMile?.toFixed2()).toBe("2.58");
    const none = computeDashboardKpis({ periodLoads: [load({ total_miles: null }), load({ total_miles: 0 })], periodExpenses: [] });
    expect(none.revenuePerMile).toBeNull();
  });

  it("sums money exactly (no float drift)", () => {
    const k = computeDashboardKpis({
      periodLoads: [load({ total_revenue: 0.1 }), load({ total_revenue: 0.2 })],
      periodExpenses: [{ amount: 0.1 }, { amount: 0.2 }, { amount: null }],
    });
    expect(k.grossRevenue.toFixed2()).toBe("0.30");
    expect(k.expenses.toFixed2()).toBe("0.30");
    expect(k.expenseCount).toBe(3);
  });

  it("empty data yields zeros — never sample values", () => {
    const k = computeDashboardKpis({ periodLoads: [], periodExpenses: [] });
    expect(k.loadCount).toBe(0);
    expect(k.totalMiles).toBe(0);
    expect(k.grossRevenue.isZero()).toBe(true);
    expect(k.expenses.isZero()).toBe(true);
    expect(k.revenuePerMile).toBeNull();
  });
});
