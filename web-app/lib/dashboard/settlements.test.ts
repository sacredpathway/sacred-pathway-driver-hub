import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTHORITATIVE_SETTLEMENT_COLUMNS,
  isAuthoritativeSettlement,
  recentSettlementViews,
  settlementStatusLabel,
  settlementStatusTone,
  type AuthoritativeSettlementRow,
} from "./settlements";

const row = (p: Partial<AuthoritativeSettlementRow>): AuthoritativeSettlementRow => ({
  id: "s1", settlement_number: "SP-2026-0001", driver_id: "d1",
  settlement_period_start: "2026-09-21", settlement_period_end: "2026-09-27",
  total_driver_earnings: 1500.5, total_additions: 100, total_deductions: 250.25, net_pay: 1350.25,
  status: "approved", engine_version: "1.0", is_estimate: false, ...p,
});

describe("recent settlements — authoritative model only", () => {
  it("accepts engine rows, rejects legacy (no engine_version) and estimates", () => {
    expect(isAuthoritativeSettlement(row({}))).toBe(true);
    expect(isAuthoritativeSettlement(row({ is_estimate: null }))).toBe(true);
    expect(isAuthoritativeSettlement(row({ engine_version: null }))).toBe(false);
    expect(isAuthoritativeSettlement(row({ engine_version: "  " }))).toBe(false);
    expect(isAuthoritativeSettlement(row({ is_estimate: true }))).toBe(false);
  });

  it("maps exact money and real driver names only", () => {
    const [v] = recentSettlementViews([row({})], new Map([["d1", "Pat"]]));
    expect(v.driverName).toBe("Pat");
    expect(v.gross.toFixed2()).toBe("1500.50");
    expect(v.deductions.toFixed2()).toBe("250.25");
    expect(v.net.toFixed2()).toBe("1350.25");
    const [unknown] = recentSettlementViews([row({ driver_id: "zzz" })], new Map());
    expect(unknown.driverName).toBeNull();
  });

  it("empty input → empty list (no sample settlements)", () => {
    expect(recentSettlementViews([], new Map())).toEqual([]);
    expect(recentSettlementViews([row({ engine_version: null }), row({ is_estimate: true })], new Map())).toEqual([]);
  });

  it("status labels/tones cover the settlement vocabulary", () => {
    expect(settlementStatusLabel("ready_for_review")).toBe("Ready for Review");
    expect(settlementStatusLabel(null)).toBe("Draft");
    expect(settlementStatusTone("paid")).toBe("success");
    expect(settlementStatusTone("voided")).toBe("danger");
    expect(settlementStatusLabel("on_hold")).toBe("On Hold");
  });

  it("dashboard query selects only authoritative columns and filters engine rows", () => {
    const cols = AUTHORITATIVE_SETTLEMENT_COLUMNS.split(",").map((c) => c.trim());
    for (const legacy of ["driver_pay_amount", "total_revenue", "paystub_id", "gross_profit"]) expect(cols).not.toContain(legacy);
    const page = readFileSync(join(__dirname, "..", "..", "app", "(app)", "dashboard", "page.tsx"), "utf8");
    expect(page).toContain('.not("engine_version", "is", null)');
    expect(page).toContain('.or("is_estimate.is.null,is_estimate.eq.false")');
    expect(page).not.toMatch(/from\("paystubs"\)|v_payroll_unified/);
  });
});
