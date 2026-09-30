import { describe, expect, it } from "vitest";
import { operationsRows } from "./operations";
import { load } from "./fixtures.test-helpers";

describe("recent loads", () => {
  it("newest paperwork first regardless of status; real driver names only", () => {
    const loads = [
      load({ id: "old", status: "in_transit", delivery_date: "2026-09-10" }),
      load({ id: "new", status: "pending", delivery_date: "2026-09-29", driver_id: "d2" }),
      load({ id: "mid", status: "settled", delivery_date: null, pickup_date: "2026-09-20" }),
    ];
    const { rows, total } = operationsRows(loads, new Map([["d2", "Jordan"]]));
    expect(total).toBe(3);
    expect(rows.map((r) => r.load.id)).toEqual(["new", "mid", "old"]);
    expect(rows[0].driverName).toBe("Jordan");
    expect(rows[1].driverName).toBeNull();
  });

  it("respects the limit", () => {
    const loads = Array.from({ length: 12 }, (_, i) => load({ delivery_date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
    const { rows, total } = operationsRows(loads, new Map(), 8);
    expect(rows).toHaveLength(8);
    expect(total).toBe(12);
  });
});
