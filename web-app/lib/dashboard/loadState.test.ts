import { describe, expect, it } from "vitest";
import { addDaysYmd, isCancelledLoad, utcYmd } from "./loadState";

describe("dashboard date helpers", () => {
  it("utcYmd is the UTC calendar day", () => {
    expect(utcYmd(new Date("2026-09-30T23:30:00-05:00"))).toBe("2026-10-01");
  });
  it("addDaysYmd crosses month/year boundaries", () => {
    expect(addDaysYmd("2026-09-30", -30)).toBe("2026-08-31");
    expect(addDaysYmd("2026-01-05", -10)).toBe("2025-12-26");
    expect(addDaysYmd("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("only cancelled/canceled counts as cancelled — no other status matters", () => {
    for (const s of ["cancelled", "canceled", "CANCELLED"]) expect(isCancelledLoad({ status: s })).toBe(true);
    for (const s of ["pending", "assigned", "in_transit", "delivered", "settled", null, "on_hold"]) {
      expect(isCancelledLoad({ status: s })).toBe(false);
    }
  });
});
