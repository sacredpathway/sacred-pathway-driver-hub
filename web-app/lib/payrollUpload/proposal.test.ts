import { describe, expect, it } from "vitest";
import { buildPayrollProposal, ForeignDocumentError, payrollConfirmationOf, type PayrollProposal } from "./proposal";
import { carrierIdentityFromProfile } from "./carrierIdentity";
import * as fx from "./fixtures";
import { DOC, DRAFT, DRIVER, DRIVER2, LOAD, NEW_DRAFT, OTHER, OWNER, PROFILE, doc, draft, input, load } from "./proposal.test-helpers";

const codes = (p: PayrollProposal) => p.blockers.map((b) => b.code);
const warnKeys = (p: PayrollProposal) => p.warnings.map((w) => w.key);
const ackAll = (p: PayrollProposal) => p.warnings.map((w) => w.key);

describe("proposal: isolation and document gate", () => {
  it("refuses a document of another account", () => {
    expect(() => buildPayrollProposal(input({ document: doc(undefined, { profile_id: OTHER }) }))).toThrow(ForeignDocumentError);
  });
  it("needs a v3 payroll extraction (v1/v2 results are not used for payroll)", () => {
    const p = buildPayrollProposal(input({ document: doc(undefined, { extraction_version: "v2" }) }));
    expect(p.status).toBe("blocked");
    expect(codes(p)).toEqual(["needs_payroll_extraction"]);
    expect(p.plan).toBeNull();
  });
  it("unprocessed, dismissed, duplicate copy and already-confirmed documents are blocked", () => {
    expect(codes(buildPayrollProposal(input({ document: doc(undefined, { status: "processing" }) })))).toEqual(["not_processed"]);
    expect(codes(buildPayrollProposal(input({ document: doc(undefined, { review_status: "dismissed" }) })))).toEqual(["dismissed"]);
    expect(codes(buildPayrollProposal(input({ document: doc(undefined, { duplicate_of: "dddddddd-0000-4000-8000-000000000009" }) })))).toContain("document_is_duplicate");
    expect(codes(buildPayrollProposal(input({ document: doc(undefined, { settlement_id: DRAFT }) })))).toContain("already_confirmed");
    const routed = doc(undefined, { routing: { payroll: { settlement_id: DRAFT, confirmed_at: "2026-10-24T00:00:00Z" } } });
    expect(codes(buildPayrollProposal(input({ document: routed })))).toContain("already_confirmed");
  });
  it("another carrier's load with the same number is invisible", () => {
    const p = buildPayrollProposal(input({ loads: [load({ profile_id: OTHER })] }));
    expect(codes(p)).toContain("load_not_found");
    expect(p.load.candidates).toEqual([]);
  });
});

describe("proposal: reference-only documents", () => {
  for (const [name, raw] of [
    ["factoring statement", fx.FACTORING_STATEMENT],
    ["external carrier statement", fx.EXTERNAL_CARRIER_STATEMENT],
    ["our own statement", fx.OWN_STATEMENT],
    ["unknown-issuer statement", fx.UNKNOWN_ISSUER_STATEMENT],
    ["paystub", fx.PAYSTUB_OK],
    ["another carrier's rate con", fx.RATE_CON_OTHER_CARRIER],
  ] as const) {
    it(`${name}: reference only, no plan, even with decisions`, () => {
      const p = buildPayrollProposal(input({
        document: doc(raw),
        decisions: { target: NEW_DRAFT, acknowledged: ["identity:unverified"], loadId: LOAD },
      }));
      expect(p.status).toBe("reference_only");
      expect(p.canConfirm).toBe(false);
      expect(p.plan).toBeNull();
      expect(p.fields.length).toBeGreaterThan(0); // evidence still shown
    });
  }
  it("POD = supporting paperwork; receipt = expense flow; neither has a plan", () => {
    expect(buildPayrollProposal(input({ document: doc(fx.BOL_POD) })).status).toBe("supporting_document");
    expect(buildPayrollProposal(input({ document: doc(fx.FUEL_RECEIPT) })).status).toBe("not_payroll");
  });
  it("own statement is reference only even when the identity matches exactly", () => {
    const p = buildPayrollProposal(input({ document: doc(fx.OWN_STATEMENT) }));
    expect(p.policy?.reasons).toEqual(["own_company_statement"]);
  });
});

describe("proposal: rate con -> draft line", () => {
  it("exact unique load: asks for a target, then is ready with a CREATE plan", () => {
    const p1 = buildPayrollProposal(input());
    expect(p1.load.selected?.id).toBe(LOAD);
    expect(p1.load.match?.evidence).toContain("load_number");
    expect(p1.driver.selected?.id).toBe(DRIVER);
    expect(p1.load.draftLineGross).toBe("2450.00");
    expect(p1.status).toBe("needs_input");
    expect(p1.needs).toContain("choose_target");
    expect(p1.blockers).toEqual([]);

    const p2 = buildPayrollProposal(input({ decisions: { target: NEW_DRAFT, acknowledged: ackAll(p1) } }));
    expect(p2.status).toBe("ready");
    expect(p2.plan).toEqual({ kind: "create", documentId: DOC, driverId: DRIVER, periodStart: "2026-10-12", periodEnd: "2026-10-18", loadId: LOAD, applyRecurring: false });
  });
  it("existing editable draft covering the delivery date -> ADD plan with the draft's version", () => {
    const drafts = [draft(), draft({ id: "5e000000-0000-4000-8000-000000000002", status: "approved" }), draft({ id: "5e000000-0000-4000-8000-000000000003", period_start: "2026-10-19", period_end: "2026-10-25" }), draft({ id: "5e000000-0000-4000-8000-000000000004", driver_id: DRIVER2 })];
    const p = buildPayrollProposal(input({ drafts, decisions: { target: { kind: "existing_draft", settlementId: DRAFT } } }));
    expect(p.target.options.map((o) => o.id)).toEqual([DRAFT]);
    expect(p.plan).toEqual({ kind: "add_to_draft", documentId: DOC, settlementId: DRAFT, expectedUpdatedAt: "2026-10-20T10:00:00.123456+00:00", loadId: LOAD });
  });
  it("a locked or foreign settlement can't be targeted", () => {
    const p = buildPayrollProposal(input({ drafts: [draft({ status: "paid" }), draft({ id: "5e000000-0000-4000-8000-000000000009", profile_id: OTHER })], decisions: { target: { kind: "existing_draft", settlementId: DRAFT } } }));
    expect(codes(p)).toContain("target_invalid");
    expect(p.plan).toBeNull();
  });
  it("period must be valid and include the load date", () => {
    expect(codes(buildPayrollProposal(input({ decisions: { target: { ...NEW_DRAFT, periodStart: "2026-10-18", periodEnd: "2026-10-12" } } })))).toContain("period_invalid");
    expect(codes(buildPayrollProposal(input({ decisions: { target: { ...NEW_DRAFT, periodStart: "2026-10-19", periodEnd: "2026-10-25" } } })))).toContain("period_excludes_load");
    expect(buildPayrollProposal(input({ decisions: { target: { ...NEW_DRAFT, periodStart: "", periodEnd: "" } } })).needs).toContain("enter_period");
  });
  it("no load with the printed number: blocked, never proposes creating a load", () => {
    const p = buildPayrollProposal(input({ loads: [load({ load_number: "OTHER-1" })] }));
    expect(codes(p)).toContain("load_not_found");
    expect(JSON.stringify(p)).not.toContain("create_load");
  });
  it("several loads with the number: owner must choose among them only", () => {
    const twin = load({ id: "aaaaaaaa-0000-4000-8000-0000000a0046", load_number: "syn 10045" });
    const p1 = buildPayrollProposal(input({ loads: [load(), twin] }));
    expect(p1.needs).toContain("choose_load");
    expect(p1.load.candidates).toHaveLength(2);
    expect(codes(buildPayrollProposal(input({ loads: [load(), twin], decisions: { loadId: "aaaaaaaa-0000-4000-8000-0000000a0099" } })))).toContain("load_choice_invalid");
    const p3 = buildPayrollProposal(input({ loads: [load(), twin], decisions: { loadId: twin.id, target: NEW_DRAFT, acknowledged: ["identity:unverified"] } }));
    expect(p3.load.selected?.id).toBe(twin.id);
  });
  it("a printed reference number can identify the load (exact)", () => {
    const raw = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, load_number: { value: "BRK-77", source_text: "BRK-77" }, reference_numbers: { value: ["SYN-10045"], source_text: "Ref SYN-10045" } } };
    expect(buildPayrollProposal(input({ document: doc(raw) })).load.selected?.id).toBe(LOAD);
  });
});

describe("proposal: duplicate payment safeguards", () => {
  for (const c of ["load_cancelled", "load_settled", "load_on_issued_paystub", "load_on_settlement"]) {
    it(`database conflict ${c} blocks`, () => {
      const p = buildPayrollProposal(input({ paymentConflicts: new Map([[LOAD, c]]), decisions: { target: NEW_DRAFT } }));
      expect(codes(p)).toContain(`payment:${c}`);
      expect(p.canConfirm).toBe(false);
    });
  }
  it("load already on a draft (or any live settlement) blocks; voided / adjustment / estimate lines don't", () => {
    const line = (status: string, extra = {}) => ({ settlement_id: DRAFT, load_id: LOAD, is_adjustment: false, settlement_status: status, is_estimate: false, ...extra });
    expect(codes(buildPayrollProposal(input({ settlementLines: [line("draft")] })))).toContain("load_on_settlement");
    expect(codes(buildPayrollProposal(input({ settlementLines: [line("approved")] })))).toContain("load_on_settlement");
    expect(codes(buildPayrollProposal(input({ settlementLines: [line("voided"), line("draft", { is_adjustment: true }), line("draft", { is_estimate: true })] })))).not.toContain("load_on_settlement");
  });
  it("cancelled, undelivered, driverless or $0 loads are blocked", () => {
    expect(codes(buildPayrollProposal(input({ loads: [load({ status: "cancelled" })] })))).toContain("load_cancelled");
    expect(codes(buildPayrollProposal(input({ loads: [load({ status: "assigned", delivery_date: "2026-11-02" })] })))).toContain("load_not_delivered");
    expect(codes(buildPayrollProposal(input({ loads: [load({ driver_id: null })] })))).toContain("load_has_no_driver");
    expect(codes(buildPayrollProposal(input({ loads: [load({ driver_id: "ffffffff-0000-4000-8000-00000000d009" })] })))).toContain("driver_not_found");
    expect(codes(buildPayrollProposal(input({ loads: [load({ line_haul_rate: 0, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: null })] })))).toContain("stored_load_no_revenue");
  });
  it("same file uploaded before -> blocked; same identifiers -> must be acknowledged; no fingerprint -> acknowledged", () => {
    const original = { id: "dddddddd-0000-4000-8000-000000000002", profile_id: OWNER, content_sha256: "c".repeat(64), document_identity: null, review_status: "approved", duplicate_of: null };
    expect(codes(buildPayrollProposal(input({ otherDocuments: [original] })))).toContain("duplicate_file");
    const same = { ...original, content_sha256: "e".repeat(64), document_identity: "rc|SYN10045|brokerage-example" };
    expect(warnKeys(buildPayrollProposal(input({ otherDocuments: [same] })))).toContain("duplicate:possible");
    expect(warnKeys(buildPayrollProposal(input({ document: doc(undefined, { content_sha256: null }) })))).toContain("duplicate:no_fingerprint");
    const foreign = { ...original, profile_id: OTHER };
    expect(codes(buildPayrollProposal(input({ otherDocuments: [foreign] })))).not.toContain("duplicate_file");
  });
});

describe("proposal: conflicts and corrections (never overwrite silently)", () => {
  it("document total differs from the load record: warning to acknowledge; the draft uses the RECORD", () => {
    const raw = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, line_haul_rate: { value: 2250, source_text: "Line Haul $2,250.00" }, total_revenue: { value: 2500, source_text: "Total Carrier Pay $2,500.00" } } };
    const p1 = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT } }));
    const row = p1.fields.find((f) => f.field === "total_revenue")!;
    expect(row).toMatchObject({ extracted: 2500, stored: 2450, compare: "conflict" });
    expect(warnKeys(p1)).toContain("conflict:total_revenue");
    expect(p1.status).toBe("needs_input");
    expect(p1.load.draftLineGross).toBe("2450.00");
    const p2 = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT, acknowledged: ackAll(p1) } }));
    expect(p2.status).toBe("ready");
    expect(p2.load.draftLineGross).toBe("2450.00");
  });
  it("owner corrects a misread value: shown as corrected, read value kept, evidence warning waived, conflict cleared", () => {
    const p = buildPayrollProposal(input({ document: doc(fx.RATE_CON_BAD_EVIDENCE), decisions: { corrections: { total_revenue: { value: "2450.00", note: "model misread" } } } }));
    const row = p.fields.find((f) => f.field === "total_revenue")!;
    expect(row).toMatchObject({ extracted: 2450, readAs: 2540, evidence: "corrected_by_owner", compare: "match", correctedNote: "model misread" });
    expect(warnKeys(p).some((k) => k.startsWith("validation:evidence_mismatch"))).toBe(false);
    expect(warnKeys(p)).not.toContain("conflict:total_revenue");
  });
  it("without the correction the misread shows evidence + conflict warnings", () => {
    const p = buildPayrollProposal(input({ document: doc(fx.RATE_CON_BAD_EVIDENCE) }));
    expect(warnKeys(p)).toEqual(expect.arrayContaining(["validation:evidence_mismatch:total_revenue", "conflict:total_revenue"]));
  });
  it("an invalid correction blocks instead of being guessed", () => {
    const p = buildPayrollProposal(input({ decisions: { corrections: { total_revenue: { value: "about 2k" } } } }));
    expect(codes(p)).toContain("correction_invalid");
  });
  it("corrections never touch the stored load record (stored column unchanged)", () => {
    const l = load();
    buildPayrollProposal(input({ loads: [l], decisions: { corrections: { total_revenue: { value: 9999 } } } }));
    expect(l.total_revenue).toBe(2450);
  });
  it("driver printed on the document differs from the load's driver: acknowledge; draft stays with the load's driver", () => {
    const raw = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, driver_name: { value: "Test Driver Two", source_text: "Driver: Test Driver Two" } } };
    const p = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT } }));
    expect(warnKeys(p)).toContain("driver:mismatch");
    expect(p.driver.selected?.id).toBe(DRIVER);
  });
  it("validation errors block (missing required fields)", () => {
    const raw = { document_type: "rate_confirmation", confidence: "high", fields: { load_number: { value: "SYN-10045", source_text: "SYN-10045" } } };
    const p = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT } }));
    expect(codes(p)).toEqual(expect.arrayContaining(["validation:missing_required"]));
    expect(p.missingFields).toEqual(["broker_name", "total_revenue"]);
  });
});

describe("proposal: carrier identity", () => {
  it("unverified identity must be acknowledged", () => {
    const p = buildPayrollProposal(input({ identity: carrierIdentityFromProfile({ ...PROFILE, company_name: null, mc_number: null, dot_number: null }) }));
    expect(warnKeys(p)).toContain("identity:unverified");
  });
  it("identity from the profile decides 'another carrier' (no hard-coded company)", () => {
    const other = carrierIdentityFromProfile({ ...PROFILE, company_name: "Different Carrier Corp", mc_number: "777777" });
    expect(buildPayrollProposal(input({ identity: other })).status).toBe("reference_only");
  });
});

describe("proposal: helpers", () => {
  it("reads the confirmation record", () => {
    expect(payrollConfirmationOf({ payroll: { settlement_id: DRAFT, confirmed_at: "x" } })).toEqual({ settlement_id: DRAFT, confirmed_at: "x" });
    expect(payrollConfirmationOf({})).toBeNull();
    expect(payrollConfirmationOf(null)).toBeNull();
  });
  it("is pure: same input -> same output", () => {
    const a = buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } }));
    const b = buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } }));
    expect(a).toEqual(b);
  });
});
