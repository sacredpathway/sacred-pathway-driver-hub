import { describe, expect, it } from "vitest";
import {
  filterLoadsByRange,
  loadInRange,
  loadPeriodDate,
  loadPeriodOrFilter,
} from "./periodDate";

const week = { from: "2026-09-28", to: "2026-10-04" };

describe("loadPeriodDate — delivery → pickup → created", () => {
  it("prefers delivery date", () => {
    expect(
      loadPeriodDate({ delivery_date: "2026-09-29", pickup_date: "2026-09-20", created_at: "2026-01-01T00:00:00Z" }),
    ).toBe("2026-09-29");
  });

  it("falls back to pickup when delivery is missing", () => {
    expect(loadPeriodDate({ delivery_date: null, pickup_date: "2026-09-20" })).toBe("2026-09-20");
    expect(loadPeriodDate({ delivery_date: "", pickup_date: "2026-09-20" })).toBe("2026-09-20");
  });

  it("falls back to created_at's UTC day when both dates are missing", () => {
    expect(loadPeriodDate({ created_at: "2026-09-30T23:30:00+00:00" })).toBe("2026-09-30");
    expect(loadPeriodDate({ created_at: "2026-09-30T20:30:00-04:00" })).toBe("2026-10-01");
  });

  it("returns null for undated or malformed loads", () => {
    expect(loadPeriodDate({})).toBeNull();
    expect(loadPeriodDate({ delivery_date: "not-a-date", created_at: "nope" })).toBeNull();
  });

  it("skips a malformed delivery date and uses pickup", () => {
    expect(loadPeriodDate({ delivery_date: "garbage", pickup_date: "2026-09-21" })).toBe("2026-09-21");
  });
});

describe("loadInRange — the week bug that prompted the change", () => {
  it("picked up last week, delivered this week → THIS week", () => {
    expect(loadInRange({ pickup_date: "2026-09-27", delivery_date: "2026-09-28" }, week)).toBe(true);
  });

  it("picked up this week, delivers next week → NOT this week", () => {
    expect(loadInRange({ pickup_date: "2026-10-04", delivery_date: "2026-10-05" }, week)).toBe(false);
  });

  it("range bounds are inclusive", () => {
    expect(loadInRange({ delivery_date: week.from }, week)).toBe(true);
    expect(loadInRange({ delivery_date: week.to }, week)).toBe(true);
    expect(loadInRange({ delivery_date: "2026-10-05" }, week)).toBe(false);
  });

  it("undated loads are excluded", () => {
    expect(loadInRange({}, week)).toBe(false);
  });

  it("filterLoadsByRange keeps order and type", () => {
    const loads = [
      { id: "a", delivery_date: "2026-09-29" },
      { id: "b", delivery_date: "2026-10-09" },
      { id: "c", pickup_date: "2026-10-01" },
    ];
    expect(filterLoadsByRange(loads, week).map((l) => l.id)).toEqual(["a", "c"]);
  });
});

describe("loadPeriodOrFilter — server-side twin of loadInRange", () => {
  it("builds the three-branch PostgREST or() expression", () => {
    expect(loadPeriodOrFilter(week)).toBe(
      "and(delivery_date.gte.2026-09-28,delivery_date.lte.2026-10-04)," +
        "and(delivery_date.is.null,pickup_date.gte.2026-09-28,pickup_date.lte.2026-10-04)," +
        "and(delivery_date.is.null,pickup_date.is.null," +
        "created_at.gte.2026-09-28T00:00:00.000Z,created_at.lte.2026-10-04T23:59:59.999Z)",
    );
  });

  it("refuses malformed ranges (no filter injection)", () => {
    expect(() => loadPeriodOrFilter({ from: "2026-09-28),or(id.neq.0", to: "2026-10-04" })).toThrow(RangeError);
    expect(() => loadPeriodOrFilter({ from: "", to: "" })).toThrow(RangeError);
  });
});
