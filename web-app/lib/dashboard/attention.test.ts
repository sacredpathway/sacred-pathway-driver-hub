import { describe, expect, it } from "vitest";
import { attentionItems, rateConfirmationLoadIds } from "./attention";
import { load } from "./fixtures.test-helpers";

const TODAY = "2026-09-30";
const withRc = (ids: string[]) => new Set(ids);
const base = { today: TODAY, includeDriverAssignment: true };
const rules = (r: ReturnType<typeof attentionItems>, id: string) => r.items.filter((i) => i.loadId === id).map((i) => i.rule).sort();
const complete = (p = {}) => load({ delivery_date: "2026-09-25", pickup_date: "2026-09-24", ...p });

describe("Missing paperwork info", () => {
  it("a complete load produces nothing — no invented alerts", () => {
    const l = complete({ id: "ok" });
    expect(attentionItems({ ...base, loadIdsWithRateConfirmation: withRc(["ok"]), loads: [l] }).total).toBe(0);
    expect(attentionItems({ ...base, loadIdsWithRateConfirmation: withRc([]), loads: [] })).toMatchObject({ total: 0, items: [] });
  });

  it("flags each blank field that changes a calculation", () => {
    const l = complete({ id: "x", total_revenue: null, total_miles: 0, driver_id: null, delivery_date: null });
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: withRc([]), loads: [l] });
    expect(rules(r, "x")).toEqual(["no_delivery_date", "no_driver", "no_miles", "no_rate", "no_rate_confirmation"]);
    expect(r.items.find((i) => i.rule === "no_rate")?.href).toBe("/loads/x/edit");
  });

  it("status never matters — pending, in transit, settled all checked the same", () => {
    for (const s of ["pending", "in_transit", "settled", "delivered", null, "on_hold"]) {
      const l = complete({ id: `s-${s}`, status: s, total_miles: null });
      expect(rules(attentionItems({ ...base, loadIdsWithRateConfirmation: withRc([`s-${s}`]), loads: [l] }), `s-${s}`)).toEqual(["no_miles"]);
    }
  });

  it("there is no pickup/drop-off rule", () => {
    const l = complete({ id: "t", status: "in_transit", delivery_date: "2026-09-01" });
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: withRc(["t"]), loads: [l] });
    expect(r.total).toBe(0);
  });

  it("cancelled loads are never flagged", () => {
    const l = complete({ id: "c", status: "cancelled", total_revenue: null, driver_id: null });
    expect(attentionItems({ ...base, loadIdsWithRateConfirmation: withRc([]), loads: [l] }).total).toBe(0);
  });

  it("only loads from the last 30 days (by delivery → pickup → created)", () => {
    const old = complete({ id: "old", delivery_date: "2026-08-30", total_revenue: null });
    const edge = complete({ id: "edge", delivery_date: "2026-08-31", total_revenue: null });
    const undatedNew = load({ id: "nd", delivery_date: null, pickup_date: null, created_at: "2026-09-29T10:00:00Z", total_revenue: 5 });
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: withRc(["old", "edge", "nd"]), loads: [old, edge, undatedNew] });
    expect(rules(r, "old")).toEqual([]);
    expect(rules(r, "edge")).toEqual(["no_rate"]);
    expect(rules(r, "nd")).toEqual(["no_delivery_date"]);
    expect(r.windowDays).toBe(30);
  });

  it("driver rule is admin-only; rate-con rule skipped when documents weren't read", () => {
    const l = complete({ id: "d", driver_id: null });
    expect(rules(attentionItems({ ...base, includeDriverAssignment: false, loadIdsWithRateConfirmation: null, loads: [l] }), "d")).toEqual([]);
  });

  it("orders by impact and counts per rule", () => {
    const loads = [complete({ id: "a", delivery_date: null }), complete({ id: "b", total_revenue: 0 })];
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: withRc(["a", "b"]), loads });
    expect(r.items.map((i) => i.rule)).toEqual(["no_rate", "no_delivery_date"]);
    expect(r.countsByRule.no_rate).toBe(1);
    expect(r.countsByRule.no_driver).toBe(0);
  });

  it("rateConfirmationLoadIds keeps only rate confirmations linked to a load", () => {
    const ids = rateConfirmationLoadIds([
      { load_id: "a", document_type: "rate_confirmation" },
      { load_id: "b", document_type: " Rate_Confirmation " },
      { load_id: "c", document_type: "fuel_receipt" },
      { load_id: null, document_type: "rate_confirmation" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("missing paperwork on a newly entered load", () => {
  it("is still checked (status never exempts a load)", async () => {
    const { NEW_LOAD_STATUS } = await import("@/lib/loads/status");
    const l = complete({ id: "n", status: NEW_LOAD_STATUS, total_miles: null });
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: withRc(["n"]), loads: [l] });
    expect(rules(r, "n")).toEqual(["no_miles"]);
  });
});
