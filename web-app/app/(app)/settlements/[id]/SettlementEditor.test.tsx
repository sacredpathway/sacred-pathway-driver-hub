import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("../actions", () => ({
  saveSettlementAction: vi.fn(), transitionSettlementAction: vi.fn(), createCustomCategoryAction: vi.fn(),
}));

import SettlementEditor, { type EditorProps } from "./SettlementEditor";
import { NO_FEES, type SettlementBundle } from "@/lib/settlements/model";
import { lineFromLoad } from "@/lib/settlements/workflow";

const P = "11111111-2222-4333-8444-555555555555";

function bundle(status: SettlementBundle["header"]["status"]): SettlementBundle {
  return {
    header: {
      id: "33333333-3333-4333-8333-333333333333", profileId: P, driverId: "22222222-2222-4222-8222-222222222222",
      periodStart: "2026-10-12", periodEnd: "2026-10-18", status, settlementNumber: "SP-2026-0007",
      settlementType: "company_driver", truckNumber: "12",
      payRule: { components: [{ id: "00000000-0000-4000-8000-000000000001", kind: "percent_of_gross", label: "Percentage of Gross", percent: "27.5", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }], feeTerms: { ...NO_FEES, factoringFeePercent: "2.5" } },
      payOnGrossRevenue: true, hoursWorked: null, notes: null, paymentMethod: null, paymentReference: null,
      driverPayPercentage: 27.5, netPay: 890.44, isEstimate: false, engineVersion: "settlement-engine/1.0",
      createdAt: null, updatedAt: "2026-10-19T10:00:00+00:00", approvedAt: null, approvedBy: null, paidAt: null, voidedAt: null, createdBy: P,
    },
    loadLines: [lineFromLoad({ id: "00000000-0000-4000-8000-000000000050", driver_id: null, load_number: "45122", broker_name: "TQL", broker_mc_number: null, pickup_date: "2026-10-13", delivery_date: "2026-10-15", origin: "Dallas, TX", destination: "Phoenix, AZ", total_miles: 1065, empty_miles: 0, line_haul_rate: 2850.55, fuel_surcharge: 312.4, accessorial_charges: 75, total_revenue: 3237.95, status: "settled" }, 0)],
    additions: [{ id: "00000000-0000-4000-8000-000000000080", category: "other", customCategoryId: "00000000-0000-4000-8000-000000000081", description: "ELD reimbursement", amount: "19.99", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null }],
    deductions: [],
  };
}

const props = (status: SettlementBundle["header"]["status"], canEdit = true): EditorProps => ({
  initial: bundle(status), updatedAt: "2026-10-19T10:00:00+00:00", driverName: "Marcus Lee", canEdit,
  customs: { available: true, categories: [{ id: "00000000-0000-4000-8000-000000000081", kind: "addition", name: "ELD reimbursement", baseCategory: "other", defaultResponsibility: "driver", defaultDriverSharePercent: "100", isArchived: false }], suggestions: { addition: [], deduction: [] } },
  eligible: [], rules: [], otherNumbers: [], alreadyPaid: [], auditTrail: [{ id: "e1", action: "created", summary: "Settlement created for Marcus Lee", actor_name: "owner@example.com", timestamp: "2026-10-19T10:00:00Z" }],
});

describe("SettlementEditor", () => {
  it("draft: editable, live exact net pay, custom category shown, finalize available", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("draft")} />);
    // 27.5% × 3,237.95 = 890.44 + 19.99 addition = 910.43 (factoring is company-paid)
    expect(html).toContain("$910.43");
    expect(html).toContain("Factoring Fee (2.5%)");
    expect(html).toContain("ELD reimbursement");
    expect(html).toContain("Finalize (approve)");
    expect(html).toContain("+ Add deduction");
    expect(html).toContain("Settlement created for Marcus Lee");
    expect(html).not.toContain("locked");
  });

  it("approved: locked read-only with reopen + mark paid, no add buttons", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("approved")} />);
    expect(html).toContain("approved and locked");
    expect(html).toContain("Reopen to edit");
    expect(html).toContain("Mark paid");
    expect(html).not.toContain("+ Add deduction");
    expect(html).not.toContain("Save changes");
  });

  it("paid: reopen goes back to approved; voided: reopen as draft", () => {
    expect(renderToStaticMarkup(<SettlementEditor {...props("paid")} />)).toContain("Reopen (back to approved)");
    const v = renderToStaticMarkup(<SettlementEditor {...props("voided")} />);
    expect(v).toContain("This settlement is voided.");
    expect(v).not.toContain("Void…");
  });

  it("non-owner: view only, no status actions", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("draft", false)} />);
    expect(html).toContain("View only");
    expect(html).not.toContain("Finalize (approve)");
  });
});
