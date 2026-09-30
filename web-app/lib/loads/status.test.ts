import { describe, expect, it } from "vitest";
import {
  KNOWN_LOAD_STATUSES,
  WRITABLE_LOAD_STATUSES,
  isAllowedStatusWrite,
  isCancelledStatus,
  isWritableLoadStatus,
  loadStatusGroup,
  loadStatusLabel,
  settlementEligibility,
  statusOptionsFor,
} from "./status";
import { LOAD_STATUSES, LOAD_STATUS_OPTIONS } from "@/app/(app)/loads/constants";

// stored value → [label, group, settlement eligibility, web-writable today]
const TABLE: Record<string, [string, string, string, boolean]> = {
  pending: ["Unassigned", "open", "after_delivery_date", false],
  active: ["Active", "open", "after_delivery_date", false],
  unassigned: ["Unassigned", "open", "after_delivery_date", true],
  assigned: ["Assigned", "open", "after_delivery_date", true],
  dispatched: ["Dispatched", "open", "after_delivery_date", false],
  picked_up: ["Picked Up", "open", "after_delivery_date", false],
  in_transit: ["In Transit", "open", "after_delivery_date", true],
  delivered: ["Delivered", "completed", "after_delivery_date", true],
  completed: ["Completed", "completed", "after_delivery_date", false],
  ready_for_settlement: ["Ready for Settlement", "completed", "completed", true],
  settled: ["Settled", "settled", "completed", true],
  cancelled: ["Cancelled", "cancelled", "never", false],
};

describe("load status vocabulary", () => {
  it("covers every known stored value", () => {
    expect(new Set(Object.keys(TABLE))).toEqual(new Set(KNOWN_LOAD_STATUSES));
  });

  it.each(Object.entries(TABLE))("%s → label, group, eligibility, writability", (raw, [label, group, elig, writable]) => {
    expect(loadStatusLabel(raw)).toBe(label);
    expect(loadStatusGroup(raw)).toBe(group);
    expect(settlementEligibility(raw)).toBe(elig);
    expect(isWritableLoadStatus(raw)).toBe(writable);
  });

  it("reads/displays cancelled, including spelling and case variants", () => {
    for (const raw of ["cancelled", "canceled", "CANCELLED", "  Cancelled "]) {
      expect(loadStatusLabel(raw)).toBe("Cancelled");
      expect(isCancelledStatus(raw)).toBe(true);
      expect(settlementEligibility(raw)).toBe("never");
    }
  });

  it("empty and unknown values never throw", () => {
    expect(loadStatusLabel(null)).toBe("—");
    expect(loadStatusLabel("")).toBe("—");
    expect(loadStatusLabel("on_hold")).toBe("On Hold");
    expect(loadStatusGroup("on_hold")).toBe("unknown");
    expect(isCancelledStatus(undefined)).toBe(false);
  });
});

describe("cancelled write gate (Phase 0.5)", () => {
  it("cancelled is absent from every writable list and form option set", () => {
    expect(WRITABLE_LOAD_STATUSES).not.toContain("cancelled");
    expect(LOAD_STATUSES).not.toContain("cancelled");
    expect(LOAD_STATUS_OPTIONS).not.toContain("cancelled");
    expect(statusOptionsFor("assigned", { includeEmpty: true }).map((o) => o.value)).not.toContain("cancelled");
  });

  it("the other writable statuses remain available", () => {
    expect([...LOAD_STATUS_OPTIONS]).toEqual([
      "unassigned", "assigned", "in_transit", "delivered", "ready_for_settlement", "settled",
    ]);
    const values = statusOptionsFor(null, { includeEmpty: true }).map((o) => o.value);
    expect(values).toEqual(["", "unassigned", "assigned", "in_transit", "delivered", "ready_for_settlement", "settled"]);
  });

  it("an existing cancelled load shows its current value but can't be newly chosen", () => {
    const opts = statusOptionsFor("cancelled");
    expect(opts.at(-1)).toEqual({ value: "cancelled", label: "Cancelled (current)" });
    expect(isAllowedStatusWrite("cancelled", "cancelled")).toBe(true);  // unchanged save
    expect(isAllowedStatusWrite("cancelled", "assigned")).toBe(false);  // newly selected
    expect(isAllowedStatusWrite("canceled", null)).toBe(false);
    expect(isAllowedStatusWrite("assigned", "cancelled")).toBe(true);   // moving off cancelled
  });

  it("legacy pending/active values are preserved on edit, not rewritten", () => {
    expect(statusOptionsFor("pending").at(-1)).toEqual({ value: "pending", label: "Unassigned (current)" });
    expect(isAllowedStatusWrite("pending", "pending")).toBe(true);
    expect(isAllowedStatusWrite("pending", "assigned")).toBe(false);
    expect(isAllowedStatusWrite("", "cancelled")).toBe(true); // clearing keeps prior edit-form behaviour
  });
});
