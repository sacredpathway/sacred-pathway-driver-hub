import { describe, expect, it } from "vitest";
import { filterHistory, historyTotals, paystubToHistory, settlementToHistory } from "./history";

const S = (o: Record<string, unknown>) => ({ id: "s" + Math.random(), status: "paid", engine_version: "settlement-engine/1.0", net_pay: 100, gross_load_revenue: 400, settlement_period_start: "2026-10-05", settlement_period_end: "2026-10-11", ...o });

describe("payroll history", () => {
  const rows = [
    settlementToHistory(S({ settlement_number: "SP-2026-0007", net_pay: 1820.45, driver_id: "d1" }), "Marcus Lee", ["45122", "45130"])!,
    settlementToHistory(S({ settlement_number: "SP-2026-0008", status: "draft", net_pay: 900, driver_id: "d2", settlement_period_start: "2026-10-12", settlement_period_end: "2026-10-18" }), "Ana Ruiz", [])!,
    settlementToHistory(S({ engine_version: null, status: null, net_pay: 700, driver_id: "d1", settlement_period_end: "2026-06-01", settlement_period_start: "2026-05-25" }), "Marcus Lee", [])!,
    paystubToHistory({ id: "p1", paystub_number: "PS-0012", status: "issued", net_pay: 555.5, gross_earnings: 700, driver_id: "d2", pay_period_start: "2026-04-01", pay_period_end: "2026-04-07", check_date: "2026-04-10" }, "Ana Ruiz"),
  ];

  it("excludes estimates and converted legacy rows", () => {
    expect(settlementToHistory(S({ is_estimate: true }), "x", [])).toBeNull();
    expect(settlementToHistory(S({ paystub_id: "p" }), "x", [])).toBeNull();
  });

  it("classifies and locks correctly", () => {
    expect(rows.map((r) => r.kind)).toEqual(["settlement", "settlement", "legacy_settlement", "paystub"]);
    expect(rows.map((r) => r.readOnly)).toEqual([true, false, true, true]);
  });

  it("searches number, driver, load number, amount", () => {
    expect(filterHistory(rows, { q: "#45130" }).map((r) => r.number)).toEqual(["SP-2026-0007"]);
    expect(filterHistory(rows, { q: "ana" })).toHaveLength(2);
    expect(filterHistory(rows, { q: "1820.45" })).toHaveLength(1);
    expect(filterHistory(rows, { q: "$1,820.45" })).toHaveLength(1);
    expect(filterHistory(rows, { q: "legacy" })).toHaveLength(2);
  });

  it("filters by driver, status, date overlap; sorts", () => {
    expect(filterHistory(rows, { driverId: "d1" })).toHaveLength(2);
    expect(filterHistory(rows, { status: "draft" })).toHaveLength(2); // blank legacy status = Draft (iPhone rule)
    expect(filterHistory(rows, { from: "2026-10-01", to: "2026-10-31" })).toHaveLength(2);
    expect(filterHistory(rows, {}).map((r) => r.dateKey)[0]).toBe("2026-10-18");
    expect(filterHistory(rows, { sort: "net_desc" })[0].net.toFixed2()).toBe("1820.45");
  });

  it("totals: paid out vs open, voids never count, exact cents", () => {
    const t = historyTotals(rows);
    expect(t.paidOut.toFixed2()).toBe("2375.95"); // 1820.45 + 555.50
    expect(t.open.toFixed2()).toBe("1600.00"); // 900 draft + 700 legacy (null status = draft)
  });
});
