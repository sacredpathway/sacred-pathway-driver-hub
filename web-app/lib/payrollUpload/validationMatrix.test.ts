// =============================================================================
//  Phase 3 payroll validation matrix: every scenario from the Phase 3 brief in
//  one place. Each must be blocked, or require an explicit acknowledgement,
//  and NO plan may ever carry an extracted money amount (the draft is always
//  calculated by the existing settlement engine from the stored load).
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildPayrollProposal, type PayrollProposal } from "./proposal";
import * as fx from "./fixtures";
import { DRAFT, LOAD, NEW_DRAFT, doc, input, load } from "./proposal.test-helpers";

const codes = (p: PayrollProposal) => p.blockers.map((b) => b.code);
const warn = (p: PayrollProposal) => p.warnings.map((w) => w.key);
const ackAll = (p: PayrollProposal) => p.warnings.map((w) => w.key);
const PLAN_KEYS = new Set(["kind", "documentId", "driverId", "periodStart", "periodEnd", "loadId", "applyRecurring", "settlementId", "expectedUpdatedAt"]);

function settle(p0: PayrollProposal, build: (ack: string[]) => PayrollProposal) {
  return build(ackAll(p0));
}

describe("Phase 3 validation matrix", () => {
  it("missing driver (load without one / driver not in the account) -> blocked", () => {
    expect(codes(buildPayrollProposal(input({ loads: [load({ driver_id: null })], decisions: { target: NEW_DRAFT } })))).toContain("load_has_no_driver");
    expect(codes(buildPayrollProposal(input({ loads: [load({ driver_id: "ffffffff-0000-4000-8000-00000000d009" })], decisions: { target: NEW_DRAFT } })))).toContain("driver_not_found");
  });

  it("ambiguous load (two loads share the printed number) -> owner must choose; never auto-picked", () => {
    const twin = load({ id: "aaaaaaaa-0000-4000-8000-0000000a0046", pickup_date: "2026-10-05", delivery_date: "2026-10-06" });
    const p = buildPayrollProposal(input({ loads: [load(), twin], decisions: { target: NEW_DRAFT } }));
    expect(p.canConfirm).toBe(false);
    expect(p.plan).toBeNull();
    const chosen = buildPayrollProposal(input({ loads: [load(), twin], decisions: { target: NEW_DRAFT, loadId: LOAD } }));
    const ready = settle(chosen, (ack) => buildPayrollProposal(input({ loads: [load(), twin], decisions: { target: NEW_DRAFT, loadId: LOAD, acknowledged: ack } })));
    expect(ready.plan).toMatchObject({ loadId: LOAD });
  });

  it("conflicting rate (document vs stored load) -> acknowledgement; the draft uses the STORED amount", () => {
    const raw = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, line_haul_rate: { value: 2900, source_text: "Line Haul $2,900.00" }, total_revenue: { value: 3150, source_text: "Total Carrier Pay $3,150.00" } } };
    const p = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT } }));
    expect(warn(p)).toEqual(expect.arrayContaining(["conflict:total_revenue", "conflict:line_haul_rate"]));
    expect(p.canConfirm).toBe(false);
    const ready = settle(p, (ack) => buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT, acknowledged: ack } })));
    expect(ready.canConfirm).toBe(true);
    expect(ready.load.draftLineGross).toBe("2450.00");
  });

  it("incorrect total (components don't add up) -> flagged, never silently fixed", () => {
    const p = buildPayrollProposal(input({ document: doc(fx.RATE_CON_SUM_MISMATCH), decisions: { target: NEW_DRAFT } }));
    expect([...codes(p), ...warn(p)].some((k) => k.startsWith("validation:"))).toBe(true);
    expect(p.canConfirm).toBe(false);
  });

  it("duplicate document (same file) -> blocked; same identifiers -> acknowledgement", () => {
    const original = { id: "dddddddd-0000-4000-8000-000000000002", profile_id: input().ownerId, content_sha256: "c".repeat(64), document_identity: null, review_status: "approved", duplicate_of: null };
    expect(codes(buildPayrollProposal(input({ otherDocuments: [original], decisions: { target: NEW_DRAFT } })))).toContain("duplicate_file");
    expect(codes(buildPayrollProposal(input({ document: doc(undefined, { duplicate_of: original.id }), decisions: { target: NEW_DRAFT } })))).toContain("document_is_duplicate");
  });

  it("cancelled load -> blocked", () => {
    expect(codes(buildPayrollProposal(input({ loads: [load({ status: "cancelled" })], decisions: { target: NEW_DRAFT } })))).toContain("load_cancelled");
  });

  it("load on an issued paystub / previously settled / on another settlement -> blocked", () => {
    for (const c of ["load_on_issued_paystub", "load_settled", "load_on_settlement"]) {
      expect(codes(buildPayrollProposal(input({ paymentConflicts: new Map([[LOAD, c]]), decisions: { target: NEW_DRAFT } })))).toContain(`payment:${c}`);
    }
    const onDraft = { settlement_id: DRAFT, load_id: LOAD, is_adjustment: false, settlement_status: "draft", is_estimate: false };
    expect(codes(buildPayrollProposal(input({ settlementLines: [onDraft], decisions: { target: NEW_DRAFT } })))).toContain("load_on_settlement");
  });

  it("settlement statements and paystubs (any issuer, incl. our own) are reference only: no plan, ever", () => {
    for (const raw of [fx.FACTORING_STATEMENT, fx.OWN_STATEMENT, fx.EXTERNAL_CARRIER_STATEMENT, fx.UNKNOWN_ISSUER_STATEMENT, fx.PAYSTUB_OK]) {
      const p = buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT, acknowledged: ["*"] } }));
      expect(p.status).toBe("reference_only");
      expect(p.plan).toBeNull();
      expect(p.canConfirm).toBe(false);
    }
  });

  it("no plan ever carries a money amount (the engine calculates from the stored load)", () => {
    const p0 = buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } }));
    const ready = settle(p0, (ack) => buildPayrollProposal(input({ decisions: { target: NEW_DRAFT, acknowledged: ack } })));
    expect(ready.plan).not.toBeNull();
    for (const k of Object.keys(ready.plan!)) expect(PLAN_KEYS.has(k)).toBe(true);
  });
});
