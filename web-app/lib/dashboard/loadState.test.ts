import { describe, expect, it } from "vitest";
import { KNOWN_LOAD_STATUSES } from "@/lib/loads/status";
import { isActiveLoad, isDeliveredLoad, utcYmd } from "./loadState";
import { load } from "./fixtures.test-helpers";

const TODAY = "2026-09-30";

describe("active vs delivered (canonical vocabulary)", () => {
  it("completed/settled groups are delivered regardless of dates", () => {
    for (const s of ["delivered", "completed", "ready_for_settlement", "settled"]) {
      expect(isDeliveredLoad(load({ status: s, delivery_date: null }), TODAY), s).toBe(true);
    }
  });

  it("open statuses become delivered once the delivery date arrives (iOS isCompleted parity)", () => {
    for (const s of ["pending", "active", "unassigned", "assigned", "dispatched", "picked_up", "in_transit", null]) {
      expect(isDeliveredLoad(load({ status: s, delivery_date: "2026-09-30" }), TODAY)).toBe(true);
      expect(isDeliveredLoad(load({ status: s, delivery_date: "2026-10-01" }), TODAY)).toBe(false);
      expect(isActiveLoad(load({ status: s, delivery_date: "2026-10-01" }), TODAY)).toBe(true);
      expect(isActiveLoad(load({ status: s, delivery_date: null }), TODAY)).toBe(true);
    }
  });

  it("cancelled (and 'canceled') is never active and never delivered", () => {
    for (const s of ["cancelled", "canceled", "CANCELLED"]) {
      expect(isActiveLoad(load({ status: s }), TODAY)).toBe(false);
      expect(isDeliveredLoad(load({ status: s, delivery_date: "2026-01-01" }), TODAY)).toBe(false);
    }
  });

  it("every known status is classified as exactly one of active/delivered/cancelled", () => {
    for (const s of KNOWN_LOAD_STATUSES) {
      const l = load({ status: s, delivery_date: "2026-10-05" });
      const states = [isActiveLoad(l, TODAY), isDeliveredLoad(l, TODAY), s === "cancelled"].filter(Boolean);
      expect(states, s).toHaveLength(1);
    }
  });

  it("utcYmd is the UTC calendar day", () => {
    expect(utcYmd(new Date("2026-09-30T23:30:00-05:00"))).toBe("2026-10-01");
  });
});
