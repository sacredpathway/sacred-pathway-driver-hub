import { describe, expect, it } from "vitest";
import { automaticDecisions, deductionsForExpenses, holdsOf, payRuleHold, payWeekFor, type ExpenseRow } from "./plan";
import { autoPayrollForDocument, type AutoDeps, type AutoDocument, type LiveDraft } from "./run";
import { autoGate } from "./wire";
import { paySettingsForDriver } from "../settlements/workflow";
import type { PayrollProposal } from "../payrollUpload/proposal";
import type { ConfirmResult } from "../payrollUpload/confirm";
import type { Deduction } from "../settlements/model";

const LOAD = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

function proposal(over: Partial<PayrollProposal> = {}): PayrollProposal {
  return {
    documentId: DOC, status: "needs_input", policy: null, extraction: null, validation: null, duplicates: null, identity: null,
    fields: [], missingFields: [],
    load: { match: null, candidates: [], selected: { id: LOAD, profile_id: "o", driver_id: DRIVER, load_number: "A1", broker_name: null, broker_mc_number: null, pickup_date: "2026-10-13", delivery_date: "2026-10-14", origin: null, destination: null, total_miles: 100, empty_miles: 0, line_haul_rate: 1000, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 1000, status: "pending" } as never, draftLineGross: "1000.00", paymentConflict: null },
    driver: { selected: { id: DRIVER, profile_id: "o", name: "D", cdl_number: null, cdl_state: null, active: true }, documentNameMatch: null },
    target: { options: [], selected: null },
    blockers: [], warnings: [], needs: ["choose_target"], canConfirm: false, plan: null,
    ...over,
  };
}

describe("pay week", () => {
  it("is the Monday–Sunday week containing the load date", () => {
    expect(payWeekFor("2026-10-14")).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Wednesday
    expect(payWeekFor("2026-10-12")).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Monday
    expect(payWeekFor("2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-18" }); // Sunday
    expect(payWeekFor("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" }); // across a year
  });
});

describe("automatic decisions", () => {
  it("no open draft -> new draft for the load's week, recurring deductions applied", () => {
    const r = automaticDecisions(proposal(), LOAD);
    expect(r.holds).toEqual([]);
    expect(r.decisions).toEqual({ loadId: LOAD, target: { kind: "new_draft", periodStart: "2026-10-12", periodEnd: "2026-10-18", applyRecurring: true } });
  });
  it("exactly one open draft -> add to it", () => {
    const r = automaticDecisions(proposal({ target: { options: [{ id: "s1", profile_id: "o", driver_id: DRIVER, period_start: "2026-10-12", period_end: "2026-10-18", status: "draft", updated_at: "x", settlement_number: null, is_estimate: false }], selected: null } }), LOAD);
    expect(r.decisions.target).toEqual({ kind: "existing_draft", settlementId: "s1" });
  });
  it("two open drafts -> hold, never a guess", () => {
    const opt = { profile_id: "o", driver_id: DRIVER, period_start: "2026-10-12", period_end: "2026-10-18", status: "draft", updated_at: "x", settlement_number: null, is_estimate: false };
    const r = automaticDecisions(proposal({ target: { options: [{ id: "a", ...opt }, { id: "b", ...opt }], selected: null } }), LOAD);
    expect(r.holds[0].code).toBe("multiple_drafts");
    expect(r.decisions.target).toBeUndefined();
  });
  it("reference-only paperwork never makes pay", () => {
    expect(automaticDecisions(proposal({ status: "reference_only" }), LOAD).holds[0].code).toMatch(/not_a_pay_document/);
  });
});

describe("holds", () => {
  it("every blocker and every unacknowledged warning holds the draft", () => {
    const h = holdsOf(proposal({
      blockers: [{ code: "load_not_delivered", message: "not delivered" }],
      warnings: [{ key: "conflict:total_revenue", code: "conflict", message: "rate differs", acknowledged: false }],
      needs: ["acknowledge:conflict:total_revenue"],
    }));
    expect(h.map((x) => x.code)).toEqual(["load_not_delivered", "conflict"]);
  });
  it("a driver with no pay rule is held (no invented rate)", () => {
    expect(payRuleHold(paySettingsForDriver({ pay_percentage: 0 }, true))?.code).toBe("no_pay_agreement");
    expect(payRuleHold(paySettingsForDriver({ pay_percentage: 70 }, true))).toBeNull();
    expect(payRuleHold(null)?.code).toBe("driver_pay_unknown");
  });
});

describe("receipts -> driver deductions", () => {
  const exp = (category: string, amount: number, id = category): ExpenseRow => ({ id, load_id: LOAD, category, amount, receipt_date: "2026-10-14", vendor_name: "Pilot", source_document_id: "doc-" + id });
  it("company driver: fuel / tolls / repairs are company costs -> no deduction", () => {
    const pay = paySettingsForDriver({ pay_percentage: 70, settlement_type: "company_driver" }, true);
    expect(deductionsForExpenses([exp("fuel", 412.5), exp("toll", 18), exp("maintenance", 300)], pay, new Set())).toEqual([]);
  });
  it("owner-operator: fuel, tolls, scale become driver deductions linked to the receipt", () => {
    const pay = paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true);
    const d = deductionsForExpenses([exp("fuel", 412.5), exp("toll", 18.25), exp("scale", 13.5), exp("lumper", 150)], pay, new Set());
    expect(d.map((x) => [x.category, x.amount, x.responsibility, x.relatedExpenseId, x.documentId])).toEqual([
      ["fuel", "412.50", "driver", "fuel", "doc-fuel"],
      ["tolls", "18.25", "driver", "toll", "doc-toll"],
      ["scale_tickets", "13.50", "driver", "scale", "doc-scale"],
    ]);
  });
  it("an expense already deducted anywhere is never deducted twice", () => {
    const pay = paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true);
    expect(deductionsForExpenses([exp("fuel", 100)], pay, new Set(["fuel"]))).toEqual([]);
  });
  it("zero / negative amounts are ignored", () => {
    const pay = paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true);
    expect(deductionsForExpenses([exp("fuel", 0), exp("toll", -5)], pay, new Set())).toEqual([]);
  });
});

describe("gate", () => {
  it("off unless the confirm gate is on; SMART_PAYROLL_AUTO=off switches only automation off", () => {
    expect(autoGate({}).enabled).toBe(false);
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).enabled).toBe(true);
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SMART_PAYROLL_AUTO: "off" }).enabled).toBe(false);
    // production needs BOTH variables to agree with the exact URL
    const prod = "https://rmzqxsfhjqrshhdjzhze.supabase.co";
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "production", NEXT_PUBLIC_SUPABASE_URL: prod }).enabled).toBe(false);
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "production", SMART_PAYROLL_PRODUCTION_ACK: "nope", NEXT_PUBLIC_SUPABASE_URL: prod }).enabled).toBe(false);
    // production also needs the pilot scope: listed carrier + an end date in the future (fails closed)
    const on = { SMART_PAYROLL_CONFIRM: "production", SMART_PAYROLL_PRODUCTION_ACK: "rmzqxsfhjqrshhdjzhze", NEXT_PUBLIC_SUPABASE_URL: prod };
    const PILOT = "23585e59-b6a2-41ce-9e44-c8b848ba16ff";
    const scoped = { ...on, SMART_PAYROLL_PILOT_PROFILES: PILOT, SMART_PAYROLL_PILOT_UNTIL: "2999-01-01T00:00:00Z" };
    expect(autoGate(on, PILOT).enabled).toBe(false); // no pilot list / end date
    expect(autoGate(scoped).enabled).toBe(false); // no signed-in carrier
    expect(autoGate(scoped, PILOT).enabled).toBe(true);
    expect(autoGate(scoped, "bbbbbbbb-0000-4000-8000-00000000000b").enabled).toBe(false); // other carrier
    expect(autoGate({ ...scoped, SMART_PAYROLL_PILOT_UNTIL: "2020-01-01T00:00:00Z" }, PILOT).enabled).toBe(false); // expired
    expect(autoGate({ ...scoped, SMART_PAYROLL_PILOT_UNTIL: "next week" }, PILOT).enabled).toBe(false); // invalid date
    expect(autoGate({ ...scoped, SMART_PAYROLL_PILOT_UNTIL: "2999-01-01T00:00:00" }, PILOT).enabled).toBe(false); // no timezone
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "production", SMART_PAYROLL_PRODUCTION_ACK: "rmzqxsfhjqrshhdjzhze", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }).enabled).toBe(false);
    expect(autoGate({ SMART_PAYROLL_CONFIRM: "staging-only", SMART_PAYROLL_PRODUCTION_ACK: "rmzqxsfhjqrshhdjzhze", NEXT_PUBLIC_SUPABASE_URL: prod }).enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
//  Orchestration with fake dependencies
// ---------------------------------------------------------------------------

function deps(over: Partial<AutoDeps> & { doc?: Partial<AutoDocument> } = {}) {
  const calls: string[] = [];
  const recorded: unknown[] = [];
  const d: AutoDeps = {
    enabled: true, disabledReason: "",
    getDocument: async () => ({ id: DOC, profile_id: "o", load_id: LOAD, settlement_id: null, review_status: "auto_routed", routedType: "rate_confirmation", ...(over.doc ?? {}) }),
    proposal: async (_id, dec) => {
      calls.push(`proposal:${dec.target ? dec.target.kind : "first"}`);
      return dec.target ? proposal({ status: "ready", needs: [], canConfirm: true, target: { options: [], selected: dec.target } }) : proposal();
    },
    driverPay: async () => paySettingsForDriver({ pay_percentage: 70 }, true),
    loadDriver: async () => DRIVER,
    confirm: async (): Promise<ConfirmResult> => { calls.push("confirm"); return { ok: true, settlementId: "S1", created: true }; },
    expensesForLoad: async () => [],
    expenseForDocument: async () => null,
    deductedExpenseIds: async () => new Set(),
    draftForLoad: async (): Promise<LiveDraft | null> => null,
    addDeductions: async (_s, _u, ds: Deduction[]) => { calls.push(`deductions:${ds.length}`); return { ok: true }; },
    record: async (_id, o) => { recorded.push(o); },
    ...over,
  };
  return { d, calls, recorded };
}

describe("autoPayrollForDocument", () => {
  it("rate con on a load with a pay rule -> one draft through the confirmation path, outcome recorded", async () => {
    const { d, calls, recorded } = deps();
    const o = await autoPayrollForDocument(d, DOC);
    expect(o).toMatchObject({ state: "drafted", settlementId: "S1", holds: [] });
    expect(calls).toEqual(["proposal:first", "proposal:new_draft", "confirm"]);
    expect(recorded).toHaveLength(1);
  });
  it("gate off -> nothing at all", async () => {
    const { d, calls } = deps({ enabled: false, disabledReason: "off" });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("off");
    expect(calls).toEqual([]);
  });
  it("document not filed yet (in review) -> skipped, nothing written", async () => {
    const { d, calls } = deps({ doc: { review_status: "needs_review" } });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("skipped");
    expect(calls).toEqual([]);
  });
  it("driver without a pay rule -> held before any write", async () => {
    const { d, calls } = deps({ driverPay: async () => paySettingsForDriver({}, true) });
    const o = await autoPayrollForDocument(d, DOC);
    expect(o.state).toBe("held");
    expect(o.holds[0].code).toBe("no_pay_agreement");
    expect(calls).not.toContain("confirm");
  });
  it("a warning on the second pass (e.g. rate conflict) -> held, never confirmed", async () => {
    const { d, calls } = deps({
      proposal: async (_id, dec) => dec.target
        ? proposal({ status: "needs_input", warnings: [{ key: "conflict:total_revenue", code: "conflict", message: "rate differs", acknowledged: false }], needs: ["acknowledge:conflict:total_revenue"], target: { options: [], selected: dec.target } })
        : proposal(),
    });
    const o = await autoPayrollForDocument(d, DOC);
    expect(o).toMatchObject({ state: "held", holds: [{ code: "conflict" }] });
    expect(calls).not.toContain("confirm");
  });
  it("already on a settlement -> skipped (idempotent re-run)", async () => {
    const { d, calls } = deps({ doc: { settlement_id: "S1" } });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("skipped");
    expect(calls).toEqual([]);
  });
  it("confirmation refused (claim conflict, load paid elsewhere) -> held with the database's reason", async () => {
    const { d } = deps({ confirm: async () => ({ ok: false, code: "claim_conflict", error: "Another confirmation is in progress." }) });
    expect(await autoPayrollForDocument(d, DOC)).toMatchObject({ state: "held", holds: [{ code: "claim_conflict" }] });
  });
  it("an exception never escapes; it is recorded as an error", async () => {
    const { d, recorded } = deps({ proposal: async () => { throw new Error("network"); } });
    const o = await autoPayrollForDocument(d, DOC);
    expect(o.state).toBe("error");
    expect(recorded).toHaveLength(1);
  });
  it("after drafting, receipts already on the load become deductions (owner-operator)", async () => {
    const { d, calls } = deps({
      driverPay: async () => paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true),
      expensesForLoad: async () => [{ id: "e1", load_id: LOAD, category: "fuel", amount: 400, receipt_date: "2026-10-14", vendor_name: "Pilot", source_document_id: "d1" }],
      draftForLoad: async () => ({ settlementId: "S1", status: "draft", updatedAt: "t", driverId: DRIVER, loadIds: [LOAD], relatedExpenseIds: [] }),
    });
    const o = await autoPayrollForDocument(d, DOC);
    expect(o).toMatchObject({ state: "drafted", deductionsAdded: 1 });
    expect(calls).toContain("deductions:1");
  });
  it("receipt for a load on an open draft -> deduction added once", async () => {
    const { d, calls } = deps({
      doc: { routedType: "fuel_receipt" },
      driverPay: async () => paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true),
      expenseForDocument: async () => ({ id: "e1", load_id: LOAD, category: "fuel", amount: 400, receipt_date: "2026-10-14", vendor_name: "Pilot", source_document_id: DOC }),
      draftForLoad: async () => ({ settlementId: "S1", status: "draft", updatedAt: "t", driverId: DRIVER, loadIds: [LOAD], relatedExpenseIds: [] }),
    });
    expect(await autoPayrollForDocument(d, DOC)).toMatchObject({ state: "deduction_added", deductionsAdded: 1 });
    expect(calls).toEqual(["deductions:1"]);
  });
  it("receipt already deducted on that draft -> nothing added", async () => {
    const { d, calls } = deps({
      doc: { routedType: "fuel_receipt" },
      driverPay: async () => paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true),
      expenseForDocument: async () => ({ id: "e1", load_id: LOAD, category: "fuel", amount: 400, receipt_date: "2026-10-14", vendor_name: "Pilot", source_document_id: DOC }),
      draftForLoad: async () => ({ settlementId: "S1", status: "draft", updatedAt: "t", driverId: DRIVER, loadIds: [LOAD], relatedExpenseIds: ["e1"] }),
    });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("skipped");
    expect(calls).toEqual([]);
  });
  it("receipt whose load is on an approved settlement only (no open draft) -> nothing changes", async () => {
    const { d, calls } = deps({
      doc: { routedType: "fuel_receipt" },
      expenseForDocument: async () => ({ id: "e1", load_id: LOAD, category: "fuel", amount: 400, receipt_date: "2026-10-14", vendor_name: "Pilot", source_document_id: DOC }),
      draftForLoad: async () => null,
    });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("skipped");
    expect(calls).toEqual([]);
  });
});

describe("owner decisions 2026-10-25", () => {
  it("lumper receipt on a driver's draft -> noted, never added to pay", async () => {
    const { d, calls } = deps({
      doc: { routedType: "lumper_fee" },
      driverPay: async () => paySettingsForDriver({ pay_percentage: 88, settlement_type: "owner_operator" }, true),
      expenseForDocument: async () => ({ id: "e9", load_id: LOAD, category: "lumper", amount: 150, receipt_date: "2026-10-14", vendor_name: "Capstone", source_document_id: DOC }),
      draftForLoad: async () => ({ settlementId: "S1", status: "draft", updatedAt: "t", driverId: DRIVER, loadIds: [LOAD], relatedExpenseIds: [] }),
    });
    const o = await autoPayrollForDocument(d, DOC);
    expect(o).toMatchObject({ state: "noted", settlementId: "S1", holds: [{ code: "lumper_not_reimbursed" }] });
    expect(calls).toEqual([]);
  });
  it("the driver's pay frequency decides the new draft's period (semimonthly)", async () => {
    const targets: unknown[] = [];
    const { d } = deps({
      driverPeriod: async () => ({ frequency: "semimonthly", recent: [] }),
      proposal: async (_id, dec) => { if (dec.target) targets.push(dec.target); return dec.target ? proposal({ status: "ready", needs: [], canConfirm: true, target: { options: [], selected: dec.target } }) : proposal(); },
    });
    expect((await autoPayrollForDocument(d, DOC)).state).toBe("drafted");
    expect(targets[0]).toEqual({ kind: "new_draft", periodStart: "2026-10-01", periodEnd: "2026-10-15", applyRecurring: true });
  });
  it("biweekly driver with no earlier two-week settlement -> held, never guessed", async () => {
    const { d, calls } = deps({ driverPeriod: async () => ({ frequency: "biweekly", recent: [] }) });
    expect(await autoPayrollForDocument(d, DOC)).toMatchObject({ state: "held", holds: [{ code: "pay_period_unknown" }] });
    expect(calls).not.toContain("confirm");
  });
});
