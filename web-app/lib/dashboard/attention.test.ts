import { describe, expect, it } from "vitest";
import { attentionItems, rateConfirmationLoadIds } from "./attention";
import { load } from "./fixtures.test-helpers";

const TODAY = "2026-09-30";
const base = { today: TODAY, includeDriverAssignment: true, loadIdsWithRateConfirmation: new Set<string>() };
const rules = (r: ReturnType<typeof attentionItems>, id: string) => r.items.filter((i) => i.loadId === id).map((i) => i.rule).sort();

describe("Attention Required rules", () => {
  it("no driver on an active load (admins only)", () => {
    const l = load({ id: "x", driver_id: null, delivery_date: "2026-10-03" });
    expect(rules(attentionItems({ ...base, loads: [l] }), "x")).toEqual(["no_driver"]);
    expect(rules(attentionItems({ ...base, includeDriverAssignment: false, loads: [l] }), "x")).toEqual([]);
  });

  it("no driver is not flagged once the load is delivered", () => {
    const l = load({ id: "x", driver_id: null, status: "pending", delivery_date: "2026-09-01" });
    expect(rules(attentionItems({ ...base, loads: [l] }), "x")).not.toContain("no_driver");
  });

  it("no delivery date on an active load", () => {
    const l = load({ id: "x", delivery_date: null, pickup_date: "2026-09-29" });
    const r = attentionItems({ ...base, loads: [l] });
    expect(rules(r, "x")).toEqual(["no_delivery_date"]);
    expect(r.items[0].href).toBe("/loads/x/edit");
  });

  it("delivery date passed while status is still in motion", () => {
    for (const s of ["assigned", "dispatched", "picked_up", "in_transit"]) {
      const l = load({ id: s, status: s, delivery_date: "2026-09-25" });
      expect(rules(attentionItems({ ...base, loadIdsWithRateConfirmation: new Set([s]), loads: [l] }), s)).toEqual(["status_behind_delivery"]);
    }
    // not for today's delivery, not for pending/delivered
    const today = load({ id: "t", status: "in_transit", delivery_date: TODAY });
    const pending = load({ id: "p", status: "pending", delivery_date: "2026-09-25" });
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: new Set(["t", "p"]), loads: [today, pending] });
    expect(r.items.filter((i) => i.rule === "status_behind_delivery")).toHaveLength(0);
  });

  it("no rate entered (null or 0)", () => {
    const a = load({ id: "a", total_revenue: null, delivery_date: "2026-10-03" });
    const b = load({ id: "b", total_revenue: 0, delivery_date: "2026-10-03" });
    const r = attentionItems({ ...base, loads: [a, b] });
    expect(rules(r, "a")).toEqual(["no_rate"]);
    expect(rules(r, "b")).toEqual(["no_rate"]);
  });

  it("no rate confirmation only for delivered loads, and only when documents were read", () => {
    const delivered = load({ id: "d", status: "delivered", delivery_date: "2026-09-20" });
    const active = load({ id: "a", delivery_date: "2026-10-03" });
    const r = attentionItems({ ...base, loads: [delivered, active] });
    expect(rules(r, "d")).toEqual(["no_rate_confirmation"]);
    expect(rules(r, "a")).toEqual([]);
    expect(rules(attentionItems({ ...base, loadIdsWithRateConfirmation: new Set(["d"]), loads: [delivered] }), "d")).toEqual([]);
    expect(attentionItems({ ...base, loadIdsWithRateConfirmation: null, loads: [delivered] }).total).toBe(0);
  });

  it("cancelled and settled loads are never flagged", () => {
    const loads = [
      load({ id: "c", status: "cancelled", driver_id: null, delivery_date: null, total_revenue: null }),
      load({ id: "s", status: "settled", driver_id: null, delivery_date: null, total_revenue: null }),
    ];
    expect(attentionItems({ ...base, loads }).total).toBe(0);
  });

  it("a clean load produces nothing — no invented alerts", () => {
    const l = load({ id: "ok", status: "in_transit", delivery_date: "2026-10-02" });
    expect(attentionItems({ ...base, loads: [l] }).total).toBe(0);
    expect(attentionItems({ ...base, loads: [] })).toMatchObject({ total: 0, items: [] });
  });

  it("orders by severity and counts per rule", () => {
    const loads = [
      load({ id: "r", total_revenue: null, delivery_date: "2026-10-03" }),
      load({ id: "s", status: "in_transit", delivery_date: "2026-09-20" }),
    ];
    const r = attentionItems({ ...base, loadIdsWithRateConfirmation: new Set(["s"]), loads });
    expect(r.items.map((i) => i.rule)).toEqual(["status_behind_delivery", "no_rate"]);
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
