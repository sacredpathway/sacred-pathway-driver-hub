import { describe, expect, it } from "vitest";
import { calculate } from "./engine";
import { NO_FEES, type Deduction, type LoadLine } from "./model";
import { statementSections } from "./statement";

// Owner report 2026-10-29: "deductions are missing on the PDF even though we put
// them in". Company-paid deductions and pay-term fees were never printed.

const P = "11111111-2222-4333-8444-555555555555";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const load = { id: id(1), loadId: id(101), loadNumber: "L1", brokerName: null, brokerMcNumber: null, pickupDate: null, deliveryDate: null, origin: null, destination: null, loadedMiles: "1000", deadheadMiles: "0", linehaul: "3000", fuelSurcharge: "0", accessorials: "0", detention: "0", layover: "0", tonu: "0", lumperReimbursement: "0", grossRateOverride: null, payRuleOverride: null, hoursWorked: null, driverEarnings: "0", payBasisDescription: "", notes: null, isAdjustment: false, correctsSettlementId: null, sortOrder: 1, rateConfirmationDocumentId: null, proofOfDeliveryDocumentId: null, createdAt: null } as LoadLine;
const ded = (n: number, category: Deduction["category"], description: string, amount: string, responsibility: Deduction["responsibility"], share: string): Deduction => ({
  id: id(300 + n), category, customCategoryId: null, description, amount, date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility, driverSharePercent: share, recurringDeductionId: null, advanceId: null, sortOrder: n, createdAt: null,
});

describe("paystub sections", () => {
  const r = calculate({
    profileId: P, settlementType: "company_driver",
    payRule: { components: [{ id: id(900), kind: "percent_of_gross", label: "Percentage of Gross", percent: "30", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }], feeTerms: null },
    payOnGrossRevenue: true, loadLines: [load], additions: [], hoursWorked: null, isEstimate: false,
    deductions: [
      ded(1, "fuel", "Fuel", "200", "driver", "100"),
      ded(2, "insurance", "Insurance", "150", "company", "0"),
      ded(3, "repair", "Tire", "100", "split", "50"),
    ],
    companyFees: { ...NO_FEES, factoringFeePercent: "2.5" },
  });
  const s = statementSections(r);

  it("every entered deduction appears on the paystub", () => {
    expect(s.driverDeductions.map((l) => [l.label, l.amount.toFixed2()])).toEqual([["Fuel", "200.00"], ["Tire", "50.00"]]);
    const company = s.companyPaid.map((l) => l.label);
    expect(company).toEqual(expect.arrayContaining(["Insurance", "Tire"]));
    expect(company.some((x) => /factoring/i.test(x))).toBe(true);
    expect(s.companyPaidTotal.toFixed2()).toBe("275.00"); // 150 + 50 + 2.5% × 3000
  });

  it("net pay is unchanged: only driver-paid amounts come off", () => {
    // 30% × 3000 = 900 − 200 − 50 = 650
    expect(r.netDriverPay.toFixed2()).toBe("650.00");
    expect(r.totalDriverDeductions.toFixed2()).toBe("250.00");
  });
});
