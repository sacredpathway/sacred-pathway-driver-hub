import { describe, expect, it } from "vitest";
import { operationsRows } from "./operations";
import { load } from "./fixtures.test-helpers";

describe("operations overview rows", () => {
  it("active loads only, soonest delivery first, undated after, real driver names", () => {
    const loads = [
      load({ id: "late", delivery_date: "2026-10-09" }),
      load({ id: "soon", delivery_date: "2026-10-01", driver_id: "d2" }),
      load({ id: "nodate", delivery_date: null, pickup_date: "2026-09-29" }),
      load({ id: "done", status: "delivered", delivery_date: "2026-09-20" }),
      load({ id: "cx", status: "cancelled", delivery_date: "2026-10-02" }),
    ];
    const names = new Map([["d2", "Jordan"]]);
    const { rows, totalActive } = operationsRows(loads, names, "2026-09-30");
    expect(totalActive).toBe(3);
    expect(rows.map((r) => r.load.id)).toEqual(["soon", "late", "nodate"]);
    expect(rows[0].driverName).toBe("Jordan");
    expect(rows[1].driverName).toBeNull(); // drv-1 not on roster → null, never a made-up name
  });

  it("respects the limit", () => {
    const loads = Array.from({ length: 12 }, (_, i) => load({ delivery_date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
    const { rows, totalActive } = operationsRows(loads, new Map(), "2026-09-30", 8);
    expect(rows).toHaveLength(8);
    expect(totalActive).toBe(12);
  });
});
