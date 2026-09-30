import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rangeToSearch, resolveRange } from "./range";

// Characterisation tests: lock in CURRENT behaviour before Phase A/D touch it.
describe("resolveRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T15:00:00Z")); // a Wednesday
  });
  afterEach(() => vi.useRealTimers());

  it("this_week is Monday → today (ISO week, matches iOS default)", () => {
    const r = resolveRange({ preset: "this_week" });
    expect([r.from, r.to]).toEqual(["2026-09-28", "2026-09-30"]);
  });

  it("last_week is the previous Monday → Sunday", () => {
    const r = resolveRange({ preset: "last_week" });
    expect([r.from, r.to]).toEqual(["2026-09-21", "2026-09-27"]);
  });

  it("month / quarter / ytd / last_year", () => {
    expect(resolveRange({ preset: "this_month" }).from).toBe("2026-09-01");
    expect(resolveRange({ preset: "last_month" })).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(resolveRange({ preset: "this_quarter" }).from).toBe("2026-07-01");
    expect(resolveRange({ preset: "ytd" }).from).toBe("2026-01-01");
    expect(resolveRange({ preset: "last_year" })).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("rolling windows include today", () => {
    expect(resolveRange({ preset: "last_30" })).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange({ preset: "all_time" }).from).toBe("1970-01-01");
  });

  it("custom ranges are validated and sorted; bad input falls back to ytd", () => {
    expect(resolveRange({ preset: "custom", from: "2026-09-10", to: "2026-09-01" }))
      .toMatchObject({ preset: "custom", from: "2026-09-01", to: "2026-09-10" });
    expect(resolveRange({ preset: "custom", from: "bad", to: "2026-09-01" }).preset).toBe("ytd");
    expect(resolveRange({ preset: "nonsense" }).preset).toBe("ytd");
    expect(resolveRange({}).preset).toBe("ytd");
  });

  it("rangeToSearch round-trips", () => {
    const r = resolveRange({ preset: "this_week" });
    expect(rangeToSearch(r)).toBe("preset=this_week&from=2026-09-28&to=2026-09-30");
  });
});
