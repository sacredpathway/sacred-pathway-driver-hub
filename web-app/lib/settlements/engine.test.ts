// Golden tests ported 1:1 from iOS SacredPathwayTests/SettlementCalculationEngineTests.swift
// (Driver Hub 2.3.5). Same inputs, same expected cents. If one of these
// changes, driver pay on web no longer matches the iPhone.
import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money/money";
import { allocate, calculate, companySideId, deterministicFeeId, reconciles, type CalcInput } from "./engine";
import {
  NO_FEES, deductionCompanyAmount, deductionDriverAmount, lineGross,
  type Addition, type AdditionCategory, type CompanyFeeTerms, type Deduction,
  type DeductionCategory, type LoadLine, type PayComponent, type PayRule, type Responsibility,
} from "./model";

const PROFILE = "11111111-2222-4333-8444-555555555555";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function comp(kind: PayComponent["kind"], p: Partial<PayComponent> = {}): PayComponent {
  return {
    id: id(900 + Math.floor(Math.random() * 99)), kind, label: p.label ?? kind,
    percent: null, rate: null, mileBasis: "loaded", fixedAmount: null, hours: null, ...p,
  };
}
const pct = (v: string): PayRule => ({ components: [comp("percent_of_gross", { percent: v })], feeTerms: null });

function load(n: number, gross: string, o: Partial<LoadLine> = {}): LoadLine {
  return {
    id: id(n), loadId: id(100 + n), loadNumber: `L${n}`, brokerName: null, brokerMcNumber: null,
    pickupDate: null, deliveryDate: null, origin: null, destination: null,
    loadedMiles: "0", deadheadMiles: "0",
    linehaul: gross, fuelSurcharge: "0", accessorials: "0", detention: "0", layover: "0",
    tonu: "0", lumperReimbursement: "0", grossRateOverride: null, payRuleOverride: null,
    hoursWorked: null, driverEarnings: "0", payBasisDescription: "", notes: null,
    isAdjustment: false, correctsSettlementId: null, sortOrder: n,
    rateConfirmationDocumentId: null, proofOfDeliveryDocumentId: null, createdAt: null, ...o,
  };
}
function addition(n: number, category: AdditionCategory, description: string, amount: string): Addition {
  return {
    id: id(200 + n), category, customCategoryId: null, description, amount, date: null,
    relatedLoadId: null, documentId: null, notes: null, sortOrder: n, createdAt: null,
  };
}
function deduction(
  n: number, category: DeductionCategory, description: string, amount: string,
  responsibility: Responsibility = "driver", share = "100",
): Deduction {
  return {
    id: id(300 + n), category, customCategoryId: null, description, amount, date: null,
    relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null,
    responsibility, driverSharePercent: share, recurringDeductionId: null, advanceId: null,
    sortOrder: n, createdAt: null,
  };
}
function fees(f: Partial<CompanyFeeTerms>): CompanyFeeTerms {
  return { ...NO_FEES, ...f };
}
function input(o: Partial<CalcInput> & { loads?: LoadLine[] } = {}): CalcInput {
  return {
    profileId: PROFILE, settlementType: "company_driver", payRule: pct("70"),
    payOnGrossRevenue: true, loadLines: o.loads ?? [], additions: [], deductions: [],
    hoursWorked: null, companyFees: NO_FEES, isEstimate: false, ...o,
  };
}
const $ = (r: Money) => r.toFixed2();

describe("settlement engine — iPhone parity goldens", () => {
  it("1. percentage pay: $5,000 at 70% = $3,500", () => {
    const r = calculate(input({ loads: [load(1, "5000")] }));
    expect($(r.grossLoadRevenue)).toBe("5000.00");
    expect($(r.driverBaseEarnings)).toBe("3500.00");
    expect($(r.netDriverPay)).toBe("3500.00");
  });

  it("percentage pay across loads", () => {
    const r = calculate(input({ loads: [load(1, "3500"), load(2, "3750")] }));
    expect($(r.grossLoadRevenue)).toBe("7250.00");
    expect($(r.driverBaseEarnings)).toBe("5075.00");
    expect(r.totalLoads).toBe(2);
  });

  it("per-load rounding sums to the total", () => {
    const r = calculate(input({ payRule: pct("33"), loads: [load(1, "333.33"), load(2, "333.33"), load(3, "333.34")] }));
    const lineSum = Money.sum(r.lineItems.filter((l) => l.kind === "loadEarning").map((l) => l.amount));
    expect(lineSum.equals(r.driverBaseEarnings)).toBe(true);
    expect(reconciles(r)).toBe(true);
  });

  it("2. flat per load", () => {
    const r = calculate(input({
      payRule: { components: [comp("flat_per_load", { rate: "400" })], feeTerms: null },
      loads: [load(1, "3000"), load(2, "2000"), load(3, "1000")],
    }));
    expect($(r.driverBaseEarnings)).toBe("1200.00");
    expect($(r.grossLoadRevenue)).toBe("6000.00");
    expect($(r.companyRetained)).toBe("4800.00");
  });

  it("3. per mile on loaded miles", () => {
    const r = calculate(input({
      payRule: { components: [comp("per_mile", { rate: "0.58", mileBasis: "loaded" })], feeTerms: null },
      loads: [load(1, "2000", { loadedMiles: "1200", deadheadMiles: "150" })],
    }));
    expect($(r.driverBaseEarnings)).toBe("696.00");
    expect(r.loadedMiles.toFixed()).toBe("1200");
    expect(r.deadheadMiles.toFixed()).toBe("150");
    expect(r.totalMiles.toFixed()).toBe("1350");
  });

  it("per mile on all miles includes deadhead", () => {
    const r = calculate(input({
      payRule: { components: [comp("per_mile", { rate: "0.58", mileBasis: "total" })], feeTerms: null },
      loads: [load(1, "2000", { loadedMiles: "1200", deadheadMiles: "150" })],
    }));
    expect($(r.driverBaseEarnings)).toBe("783.00");
  });

  it("fractional per-mile rate rounds once: $0.585 × 1,001 = $585.59", () => {
    const r = calculate(input({
      payRule: { components: [comp("per_mile", { rate: "0.585" })], feeTerms: null },
      loads: [load(1, "2000", { loadedMiles: "1001" })],
    }));
    expect($(r.driverBaseEarnings)).toBe("585.59");
    // iOS basis text prints the rate via Money.formatted (cents).
    expect(r.loadPayBasis.get(id(1))).toBe("1,001 mi × $0.59");
  });

  it("4. weekly salary once per settlement", () => {
    const r = calculate(input({
      payRule: { components: [comp("weekly_salary", { rate: "1400" })], feeTerms: null },
      loads: [load(1, "3000"), load(2, "4000")],
    }));
    expect($(r.driverBaseEarnings)).toBe("1400.00");
    expect(r.lineItems.filter((l) => l.kind === "settlementEarning")).toHaveLength(1);
  });

  it("hourly: 42.5 hrs × $28.00 = $1,190", () => {
    const r = calculate(input({
      payRule: { components: [comp("hourly", { rate: "28" })], feeTerms: null },
      loads: [load(1, "2000")], hoursWorked: "42.5",
    }));
    expect($(r.driverBaseEarnings)).toBe("1190.00");
  });

  it("hourly without hours warns and pays zero", () => {
    const r = calculate(input({
      payRule: { components: [comp("hourly", { rate: "28" })], feeTerms: null },
      loads: [load(1, "2000")],
    }));
    expect($(r.driverBaseEarnings)).toBe("0.00");
    expect(r.warnings.some((w) => w.includes("no hours"))).toBe(true);
  });

  it("manual pay", () => {
    const r = calculate(input({
      payRule: { components: [comp("manual", { fixedAmount: "2222" })], feeTerms: null },
      loads: [load(1, "9000")],
    }));
    expect($(r.driverBaseEarnings)).toBe("2222.00");
  });

  it("5. combination pay adds every component", () => {
    const r = calculate(input({
      payRule: {
        components: [
          comp("percent_of_gross", { percent: "25" }),
          comp("per_mile", { rate: "0.10" }),
          comp("weekly_salary", { label: "Base", rate: "500" }),
        ],
        feeTerms: null,
      },
      loads: [load(1, "4000", { loadedMiles: "1000" })],
    }));
    expect($(r.driverBaseEarnings)).toBe("1600.00");
  });

  it("6. per-load override wins", () => {
    const r = calculate(input({ loads: [load(1, "1000"), load(2, "1000", { payRuleOverride: pct("50") })] }));
    expect($(r.driverBaseEarnings)).toBe("1200.00");
  });

  it("7. additions raise net pay, not gross load revenue", () => {
    const r = calculate(input({
      loads: [load(1, "5000")],
      additions: [addition(1, "detention", "Detention at receiver", "150"), addition(2, "safety_bonus", "Clean inspection bonus", "250")],
    }));
    expect($(r.grossLoadRevenue)).toBe("5000.00");
    expect($(r.totalAdditions)).toBe("400.00");
    expect($(r.settlementGross)).toBe("5400.00");
    expect($(r.driverBaseEarnings)).toBe("3500.00");
    expect($(r.netDriverPay)).toBe("3900.00");
  });

  it("8. multiple deductions", () => {
    const r = calculate(input({
      loads: [load(1, "10000")],
      deductions: [deduction(1, "fuel", "Fuel", "1500"), deduction(2, "insurance", "Insurance", "450"), deduction(3, "truck_lease", "Truck payment", "1300")],
    }));
    expect($(r.driverBaseEarnings)).toBe("7000.00");
    expect($(r.totalDriverDeductions)).toBe("3250.00");
    expect($(r.netDriverPay)).toBe("3750.00");
  });

  it("company-paid deductions do not touch the check", () => {
    const r = calculate(input({
      loads: [load(1, "10000")],
      deductions: [deduction(1, "fuel", "Fuel", "1500", "company"), deduction(2, "insurance", "Insurance", "450", "driver")],
    }));
    expect($(r.totalDriverDeductions)).toBe("450.00");
    expect($(r.companyExpenses)).toBe("1500.00");
    expect($(r.netDriverPay)).toBe("6550.00");
    expect($(r.companyRetained)).toBe("1950.00");
  });

  it("split responsibility divides the line", () => {
    const r = calculate(input({ loads: [load(1, "10000")], deductions: [deduction(1, "repair", "Tire repair", "1000", "split", "60")] }));
    expect($(r.totalDriverDeductions)).toBe("600.00");
    expect($(r.companyExpenses)).toBe("400.00");
    expect($(r.netDriverPay)).toBe("6400.00");
  });

  it("split with odd cents sums to the whole line", () => {
    const d = deduction(1, "repair", "Odd split", "1000.01", "split", "33.3333");
    expect(deductionDriverAmount(d).plus(deductionCompanyAmount(d)).toFixed2()).toBe("1000.01");
  });

  it("9. company fees expand into deduction lines (company-borne by default)", () => {
    const r = calculate(input({
      loads: [load(1, "10000")],
      companyFees: fees({ dispatcherFeePercent: "5", factoringFeePercent: "2.5", authorityFee: "100", maintenanceReserve: "200" }),
    }));
    expect($(r.totalDriverDeductions)).toBe("0.00");
    expect($(r.companyExpenses)).toBe("1050.00");
    expect($(r.netDriverPay)).toBe("7000.00");
    expect($(r.companyRetained)).toBe("1950.00");
  });

  it("fees charged to the driver come off the check", () => {
    const r = calculate(input({ loads: [load(1, "10000")], companyFees: fees({ factoringFeePercent: "3", factoringFeeResponsibility: "driver" }) }));
    expect($(r.totalDriverDeductions)).toBe("300.00");
    expect($(r.netDriverPay)).toBe("6700.00");
  });

  it("fee line ids are stable across recalculation", () => {
    const i = input({ loads: [load(1, "10000")], companyFees: fees({ dispatcherFeePercent: "5" }) });
    const a = calculate(i).lineItems.filter((l) => l.kind === "companyExpense").map((l) => l.id);
    const b = calculate(i).lineItems.filter((l) => l.kind === "companyExpense").map((l) => l.id);
    expect(a).toEqual(b);
    expect(deterministicFeeId("dispatcher_fee", PROFILE)).toMatch(/^[0-9A-F-]{36}$/);
  });

  it("10. percent of net pays on revenue minus company costs", () => {
    const r = calculate(input({
      payRule: pct("25"), payOnGrossRevenue: false, loads: [load(1, "10000")],
      deductions: [deduction(1, "fuel", "Fuel", "2000", "company")],
    }));
    expect($(r.driverBaseEarnings)).toBe("2000.00");
  });

  it("percent of net allocation sums exactly", () => {
    const r = calculate(input({
      payRule: pct("33.33"), payOnGrossRevenue: false,
      loads: [load(1, "3333"), load(2, "3333"), load(3, "3334")],
      deductions: [deduction(1, "fuel", "Fuel", "1000", "company")],
    }));
    const lineSum = Money.sum(r.lineItems.filter((l) => l.kind === "loadEarning").map((l) => l.amount));
    expect(lineSum.equals(r.driverBaseEarnings)).toBe(true);
    expect(r.warnings.every((w) => !w.includes("residual"))).toBe(true);
  });

  it("11. lease operator carries its own costs", () => {
    const r = calculate(input({
      settlementType: "lease_operator", loads: [load(1, "8000")],
      deductions: [
        deduction(1, "truck_lease", "Weekly truck payment", "1300"),
        deduction(2, "insurance", "Occupational + physical damage", "450"),
        deduction(3, "fuel", "Fuel", "1600"),
        deduction(4, "escrow", "Maintenance escrow", "200"),
      ],
      companyFees: fees({ factoringFeePercent: "3" }),
    }));
    expect($(r.driverBaseEarnings)).toBe("5600.00");
    expect($(r.totalDriverDeductions)).toBe("3550.00");
    expect($(r.netDriverPay)).toBe("2050.00");
    expect($(r.companyExpenses)).toBe("240.00");
    expect($(r.companyRetained)).toBe("5710.00");
  });

  it("12. company retained = revenue − driver − company costs", () => {
    const r = calculate(input({
      loads: [load(1, "10000")],
      additions: [addition(1, "bonus", "Bonus", "200")],
      deductions: [deduction(1, "fuel", "Fuel", "2000", "company"), deduction(2, "cash_advance", "Advance", "500")],
    }));
    expect($(r.netDriverPay)).toBe("6700.00");
    expect($(r.companyExpenses)).toBe("2000.00");
    expect($(r.companyRetained)).toBe("1300.00");
    expect(r.companyMargin.equals(r.companyRetained)).toBe(true);
  });

  it("13. metrics", () => {
    const r = calculate(input({
      loads: [load(1, "4000", { loadedMiles: "1000", deadheadMiles: "100" }), load(2, "3000", { loadedMiles: "800", deadheadMiles: "100" })],
      deductions: [deduction(1, "fuel", "Fuel", "1000", "company")],
    }));
    expect(r.totalMiles.toFixed()).toBe("2000");
    expect($(r.revenuePerMile)).toBe("3.50");
    expect($(r.driverEarningsPerMile)).toBe("2.45");
    expect($(r.fuelCostPerMile)).toBe("0.50");
    expect(r.expenseRatio.toFixed()).toBe("0.8429");
  });

  it("zero miles does not divide by zero", () => {
    const r = calculate(input({ loads: [load(1, "1000")] }));
    expect($(r.revenuePerMile)).toBe("0.00");
    expect(r.warnings.some((w) => w.includes("No mileage"))).toBe(true);
  });

  it("14. every result reconciles", () => {
    const r = calculate(input({
      payRule: { components: [comp("percent_of_gross", { percent: "68" }), comp("per_mile", { rate: "0.07" })], feeTerms: null },
      loads: [load(1, "3333", { loadedMiles: "777" }), load(2, "2121", { loadedMiles: "613" })],
      additions: [addition(1, "detention", "Detention", "137")],
      deductions: [deduction(1, "fuel", "Fuel", "911"), deduction(2, "repair", "Repair", "333", "split", "50")],
      companyFees: fees({ dispatcherFeePercent: "4.5" }),
    }));
    expect(reconciles(r)).toBe(true);
  });

  it("empty settlement is zero, not a crash", () => {
    const r = calculate(input({ loads: [] }));
    expect($(r.netDriverPay)).toBe("0.00");
    expect(reconciles(r)).toBe(true);
  });

  it("16. gross built from accessorial components; override wins", () => {
    const l = load(1, "2500", { fuelSurcharge: "300", detention: "150", layover: "200", tonu: "0", lumperReimbursement: "75", accessorials: "25" });
    expect(lineGross(l).toFixed2()).toBe("3250.00");
    expect(lineGross({ ...l, grossRateOverride: "2800" }).toFixed2()).toBe("2800.00");
  });

  it("17. allocation never loses a cent; zero weight splits evenly", () => {
    const out = allocate(Money.fromCents(1000), [[id(1), Money.fromCents(100)], [id(2), Money.fromCents(100)], [id(3), Money.fromCents(100)]]);
    expect(Money.sum([...out.values()]).toFixed2()).toBe("10.00");
    expect(out.get(id(1))!.toFixed2()).toBe("3.34"); // first maximal bucket absorbs the residual
    const even = allocate(Money.fromCents(1000), [[id(1), Money.zero], [id(2), Money.zero]]);
    expect(even.get(id(1))!.toFixed2()).toBe("5.00");
  });

  it("companySideId is a deterministic sibling id (iOS XOR)", () => {
    // byte 14 ^= 0x01, byte 15 ^= 0xC0
    expect(companySideId("00000000-0000-4000-8000-000000000001")).toBe("00000000-0000-4000-8000-0000000001C1");
  });

  it("cent precision: half away from zero, like the iPhone", () => {
    const r = calculate(input({ payRule: pct("50"), loads: [load(1, "0.03")] })); // 0.015 → 0.02
    expect($(r.driverBaseEarnings)).toBe("0.02");
    const neg = calculate(input({ payRule: pct("50"), loads: [load(1, "10")], deductions: [deduction(1, "other", "x", "0.005")] }));
    expect($(neg.totalDriverDeductions)).toBe("0.01");
  });
});
