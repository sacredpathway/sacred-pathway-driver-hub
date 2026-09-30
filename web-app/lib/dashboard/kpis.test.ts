import { describe, expect, it } from "vitest";
import { filterLoadsByRange } from "@/lib/loads/periodDate";
import { computeDashboardKpis } from "./kpis";
import { load } from "./fixtures.test-helpers";

const TODAY = "2026-09-30"; // Wednesday
const WEEK = { from: "2026-09-28", to: "2026-09-30" };

describe("computeDashboardKpis", () => {
  const loads = [
    load({ id: "a", status: "in_transit", pickup_date: "2026-09-29", delivery_date: "2026-10-02", total_revenue: 2500.1, total_miles: 1000 }),
    load({ id: "b", status: "delivered", pickup_date: "2026-09-26", delivery_date: "2026-09-29", total_revenue: 1800.2, total_miles: 600 }),
    // picked up this week, delivered after it → NOT delivered this week (delivery-date rule)
    load({ id: "c", status: "assigned", pickup_date: "2026-09-28", delivery_date: "2026-10-06", total_revenue: 900, total_miles: 0 }),
    // pending, delivery date passed this week → delivered (iOS rule)
    load({ id: "d", status: "pending", driver_id: null, pickup_date: "2026-09-27", delivery_date: "2026-09-28", total_revenue: 1200, total_miles: null }),
    // delivered last week
    load({ id: "e", status: "settled", pickup_date: "2026-09-20", delivery_date: "2026-09-22", total_revenue: 3000, total_miles: 1200 }),
    // cancelled inside the week
    load({ id: "f", status: "cancelled", pickup_date: "2026-09-29", delivery_date: "2026-09-30", total_revenue: 700, total_miles: 300 }),
  ];

  it("counts active and delivered-this-week by the canonical rules", () => {
    const k = computeDashboardKpis({ allLoads: loads, periodLoads: loads, periodExpenses: [], thisWeek: WEEK, today: TODAY });
    expect(k.activeLoads).toBe(2); // a, c
    expect(k.deliveredThisWeek).toBe(2); // b, d (not c, not e, not cancelled f)
    expect(k.deliveredThisWeekRevenue.toFixed2()).toBe("3000.20");
  });

  it("gross revenue is the exact period sum (same set as the revenue report) and surfaces cancelled", () => {
    const period = filterLoadsByRange(loads, WEEK); // a? no (delivery 10-02) → b, d, f
    const k = computeDashboardKpis({ allLoads: loads, periodLoads: period, periodExpenses: [], thisWeek: WEEK, today: TODAY });
    expect(period.map((l) => l.id).sort()).toEqual(["b", "d", "f"]);
    expect(k.grossRevenue.toFixed2()).toBe("3700.20");
    expect(k.periodLoadCount).toBe(3);
    expect(k.cancelledInPeriodCount).toBe(1);
    expect(k.cancelledInPeriodRevenue.toFixed2()).toBe("700.00");
  });

  it("sums money exactly (no float drift)", () => {
    const tiny = [load({ total_revenue: 0.1 }), load({ total_revenue: 0.2 })];
    const k = computeDashboardKpis({
      allLoads: tiny, periodLoads: tiny, periodExpenses: [{ amount: 0.1 }, { amount: 0.2 }, { amount: null }],
      thisWeek: WEEK, today: TODAY,
    });
    expect(k.grossRevenue.toFixed2()).toBe("0.30");
    expect(k.expenses.toFixed2()).toBe("0.30");
    expect(k.expenseCount).toBe(3);
  });

  it("revenue per mile only divides loads that have miles; null when none", () => {
    const k = computeDashboardKpis({ allLoads: loads, periodLoads: loads, periodExpenses: [], thisWeek: WEEK, today: TODAY });
    // miled loads: a 2500.10/1000, b 1800.20/600, e 3000/1200, f 700/300 → 8000.30 / 3100
    expect(k.milesCounted).toBe(3100);
    expect(k.revenuePerMile?.toFixed2()).toBe("2.58");
    const none = computeDashboardKpis({
      allLoads: [], periodLoads: [load({ total_miles: null }), load({ total_miles: 0 })], periodExpenses: [],
      thisWeek: WEEK, today: TODAY,
    });
    expect(none.revenuePerMile).toBeNull();
  });

  it("empty data yields zeros — never sample values", () => {
    const k = computeDashboardKpis({ allLoads: [], periodLoads: [], periodExpenses: [], thisWeek: WEEK, today: TODAY });
    expect(k.activeLoads).toBe(0);
    expect(k.deliveredThisWeek).toBe(0);
    expect(k.grossRevenue.isZero()).toBe(true);
    expect(k.expenses.isZero()).toBe(true);
    expect(k.revenuePerMile).toBeNull();
  });
});
