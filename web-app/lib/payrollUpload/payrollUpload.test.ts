import { describe, expect, it } from "vitest";
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import { payrollUseOf } from "./policy";
import { applyResolutions, compareWithStored, correctionsOf, validatePayrollExtraction } from "./validation";
import { blocksPayroll, detectDuplicates, documentIdentity, loadPayrollState, sha256Hex, type ExistingDocument } from "./duplicates";
import { convertForExtraction, planUpload, sniffFileType } from "./heic";
import * as fx from "./fixtures";

const TODAY = "2026-10-24";
const S = sanitizePayrollExtraction;
const codes = (r: { issues: { code: string; severity: string }[] }) => r.issues.map((i) => `${i.severity}:${i.code}`);

// ---------------------------------------------------------------------------
describe("policy: reference-only statements, human review always", () => {
  it("factoring statement -> reference only", () => {
    expect(payrollUseOf(S(fx.FACTORING_STATEMENT), fx.OWN_COMPANY)).toEqual({ use: "reference_only", reasons: ["factoring_company_statement"], requiresHumanReview: true });
  });
  it("external-carrier statement -> reference only", () => {
    expect(payrollUseOf(S(fx.EXTERNAL_CARRIER_STATEMENT), fx.OWN_COMPANY).reasons).toEqual(["external_carrier_statement"]);
  });
  it("statement with unknown issuer -> reference only (never assumed ours)", () => {
    expect(payrollUseOf(S(fx.UNKNOWN_ISSUER_STATEMENT), fx.OWN_COMPANY)).toMatchObject({ use: "reference_only", reasons: ["issuer_unconfirmed"] });
  });
  it("even our own statement is reference only in phase 1", () => {
    expect(payrollUseOf(S(fx.OWN_STATEMENT), fx.OWN_COMPANY)).toMatchObject({ use: "reference_only", reasons: ["own_company_statement"] });
  });
  it("paystub = completed payroll record -> reference only", () => {
    expect(payrollUseOf(S(fx.PAYSTUB_OK), fx.OWN_COMPANY)).toMatchObject({ use: "reference_only", reasons: ["completed_payroll_record"] });
  });
  it("our rate con -> draft candidate; another carrier's -> reference only", () => {
    expect(payrollUseOf(S(fx.RATE_CON_OK), fx.OWN_COMPANY)).toMatchObject({ use: "draft_candidate", reasons: [] });
    expect(payrollUseOf(S(fx.RATE_CON_OTHER_CARRIER), fx.OWN_COMPANY)).toMatchObject({ use: "reference_only", reasons: ["external_carrier_rate_confirmation"] });
  });
  it("rate con with no carrier printed -> candidate flagged carrier_unconfirmed", () => {
    const { carrier_name: _a, carrier_mc_number: _b, ...rest } = fx.RATE_CON_OK.fields;
    expect(payrollUseOf(S({ ...fx.RATE_CON_OK, fields: rest }), fx.OWN_COMPANY).reasons).toEqual(["carrier_unconfirmed"]);
  });
  it("POD supports, receipts go to the expense flow, every result needs review", () => {
    expect(payrollUseOf(S(fx.BOL_POD), fx.OWN_COMPANY).use).toBe("supporting_document");
    expect(payrollUseOf(S(fx.FUEL_RECEIPT), fx.OWN_COMPANY).use).toBe("expense_candidate");
    for (const f of [fx.RATE_CON_OK, fx.BOL_POD, fx.FUEL_RECEIPT, fx.PAYSTUB_OK]) {
      expect(payrollUseOf(S(f), fx.OWN_COMPANY).requiresHumanReview).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("validation (cent-exact)", () => {
  it("clean rate con: no errors, no warnings", () => {
    const r = validatePayrollExtraction(S(fx.RATE_CON_OK), { today: TODAY });
    expect(r.issues).toEqual([]);
    expect(r.blocking).toBe(false);
  });
  it("rate components vs total mismatch is a warning with cents", () => {
    const r = validatePayrollExtraction(S(fx.RATE_CON_SUM_MISMATCH), { today: TODAY });
    const i = r.issues.find((x) => x.code === "rate_components_mismatch")!;
    expect(i).toMatchObject({ severity: "warning", expected_cents: 250000, actual_cents: 245000 });
  });
  it("evidence mismatch surfaces as a warning", () => {
    expect(codes(validatePayrollExtraction(S(fx.RATE_CON_BAD_EVIDENCE), { today: TODAY }))).toContain("warning:evidence_mismatch");
  });
  it("valid statement passes all sum checks", () => {
    const r = validatePayrollExtraction(S(fx.FACTORING_STATEMENT), { today: TODAY });
    expect(r.blocking).toBe(false);
    expect(r.issues).toEqual([]);
  });
  it("statement net mismatch blocks", () => {
    const r = validatePayrollExtraction(S(fx.STATEMENT_NET_MISMATCH), { today: TODAY });
    expect(r.blocking).toBe(true);
    expect(r.issues.find((i) => i.code === "statement_totals_mismatch")).toMatchObject({ expected_cents: 239100, actual_cents: 231900 });
  });
  it("conflicting amounts for the same load block; normalises load numbers", () => {
    const r = validatePayrollExtraction(S(fx.STATEMENT_CONFLICTING_LINES), { today: TODAY });
    expect(codes(r)).toContain("error:conflicting_line_amounts");
    expect(codes(r)).toContain("error:line_items_gross_mismatch");
  });
  it("same load twice with the same amount -> duplicate warning", () => {
    const dup = { ...fx.FACTORING_STATEMENT, line_items: [...fx.FACTORING_STATEMENT.line_items, fx.FACTORING_STATEMENT.line_items[0]] };
    expect(codes(validatePayrollExtraction(S(dup), { today: TODAY }))).toContain("warning:duplicate_line_item");
  });
  it("paystub: totals and deduction lines reconcile to the cent (412.35)", () => {
    expect(validatePayrollExtraction(S(fx.PAYSTUB_OK), { today: TODAY }).issues).toEqual([]);
    const bad = { ...fx.PAYSTUB_OK, line_items: fx.PAYSTUB_OK.line_items.slice(0, 3) };
    expect(codes(validatePayrollExtraction(S(bad), { today: TODAY }))).toContain("error:line_items_deductions_mismatch");
  });
  it("floating-point sums do not create false mismatches (0.1 + 0.2)", () => {
    const st = { document_type: "settlement_statement", fields: { statement_number: { value: "X-1" }, gross_amount: { value: 0.3, source_text: "0.30" }, total_deductions: { value: 0.3, source_text: "0.30" }, net_amount: { value: 0, source_text: "0.00" } }, line_items: [{ kind: "deduction", amount: 0.1, source_text: "0.10" }, { kind: "deduction", amount: 0.2, source_text: "0.20" }] };
    expect(codes(validatePayrollExtraction(S(st), { today: TODAY }))).not.toContain("error:line_items_deductions_mismatch");
  });
  it("dates: order, future, old, outside-period", () => {
    const rc = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, pickup_date: { value: "2026-10-14", source_text: "10/14/2026" } } };
    expect(codes(validatePayrollExtraction(S(rc), { today: TODAY }))).toContain("error:date_order");
    const fut = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, delivery_date: { value: "2027-01-10", source_text: "01/10/2027" } } };
    expect(codes(validatePayrollExtraction(S(fut), { today: TODAY }))).toContain("warning:date_in_future");
    const old = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, pickup_date: { value: "2023-01-01", source_text: "01/01/2023" } } };
    expect(codes(validatePayrollExtraction(S(old), { today: TODAY }))).toContain("warning:date_very_old");
    const out = { ...fx.FACTORING_STATEMENT, line_items: [{ ...fx.FACTORING_STATEMENT.line_items[0], date: "2026-10-20" }, ...fx.FACTORING_STATEMENT.line_items.slice(1)] };
    expect(codes(validatePayrollExtraction(S(out), { today: TODAY }))).toContain("warning:line_outside_period");
  });
  it("missing required fields block", () => {
    const r = validatePayrollExtraction(S({ document_type: "rate_confirmation", fields: { load_number: { value: "SYN-1" } } }), { today: TODAY });
    expect(r.blocking).toBe(true);
    expect(r.issues.filter((i) => i.code === "missing_required").map((i) => i.fields[0])).toEqual(["broker_name", "total_revenue"]);
  });
  it("money with no quoted text needs a human check", () => {
    const r = validatePayrollExtraction(S({ document_type: "fuel_receipt", vendor_name: "X Fuel", expense_amount: 10, receipt_date: "2026-10-20" }), { today: TODAY });
    expect(codes(r)).toContain("warning:unverified_amount");
  });
});

// ---------------------------------------------------------------------------
describe("extracted vs stored: never overwrite silently", () => {
  const extracted = { load_number: "SYN-10045", total_revenue: 2450, delivery_date: "2026-10-13", broker_name: "Example Brokerage Inc" };
  const stored = { load_number: "syn-10045", total_revenue: "2400.00", delivery_date: null, broker_name: "Example Brokerage Inc" };
  const map = { load_number: "load_number", total_revenue: "total_revenue", delivery_date: "delivery_date", broker_name: "broker_name" };

  it("classifies match / conflict / new", () => {
    const c = compareWithStored(extracted, stored, map);
    expect(Object.fromEntries(c.map((x) => [x.field, x.status]))).toEqual({ load_number: "match", total_revenue: "conflict", delivery_date: "new", broker_name: "match" });
  });
  it("refuses to proceed with unresolved conflicts or new values", () => {
    const c = compareWithStored(extracted, stored, map);
    expect(() => applyResolutions(c, {})).toThrow("unresolved_fields:total_revenue,delivery_date");
  });
  it("keep_stored keeps the stored value; use_extracted only when chosen; corrections recorded", () => {
    const c = compareWithStored(extracted, stored, map);
    const r = applyResolutions(c, { total_revenue: { resolution: "keep_stored" }, delivery_date: { resolution: "use_extracted" } });
    expect(r.find((x) => x.field === "total_revenue")).toEqual({ field: "total_revenue", value: "2400.00", source: "stored" });
    expect(r.find((x) => x.field === "delivery_date")).toEqual({ field: "delivery_date", value: "2026-10-13", source: "extracted" });
    expect(correctionsOf(c, r)).toEqual([{ field: "total_revenue", extracted: 2450, saved: "2400.00", source: "stored" }]);
  });
  it("manual entry requires a value", () => {
    const c = compareWithStored(extracted, stored, map);
    expect(() => applyResolutions(c, { total_revenue: { resolution: "enter_manually" }, delivery_date: { resolution: "keep_stored" } })).toThrow("manual_value_missing:total_revenue");
  });
});

// ---------------------------------------------------------------------------
describe("duplicates", () => {
  it("sha256 matches the known vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("identity keys are stable across formatting and null when identifiers are weak", () => {
    const a = documentIdentity("rate_confirmation", { load_number: "SYN-10045", broker_name: "Example Brokerage, Inc." });
    const b = documentIdentity("rate_confirmation", { load_number: "syn 10045", broker_name: "EXAMPLE BROKERAGE INC" });
    expect(a).toBe(b);
    expect(documentIdentity("rate_confirmation", { load_number: "SYN-10045" })).toBeNull();
    expect(documentIdentity("other", { load_number: "SYN-10045" })).toBeNull();
    expect(documentIdentity("settlement_statement", S(fx.FACTORING_STATEMENT).values, "Synthetic Factoring Co")).toBe("st|factoring-synthetic|REM5501");
    expect(documentIdentity("paystub", S(fx.PAYSTUB_OK).values)).toBe("ps|driver-test-two|2026-10-04|138765");
  });

  const sha = "a".repeat(64);
  const rows: ExistingDocument[] = [
    { id: "d1", profile_id: "me", content_sha256: sha, document_identity: null, review_status: "approved", duplicate_of: null },
    { id: "d2", profile_id: "me", content_sha256: sha, document_identity: null, review_status: "dismissed", duplicate_of: "d1" },
    { id: "d3", profile_id: "me", content_sha256: "b".repeat(64), document_identity: "rc|SYN10045|example-brokerage", review_status: "needs_review", duplicate_of: null },
    { id: "x1", profile_id: "someone-else", content_sha256: sha, document_identity: "rc|SYN10045|example-brokerage", review_status: null, duplicate_of: null },
  ];
  it("exact file duplicate points at the root original; other accounts are invisible", () => {
    const r = detectDuplicates({ profileId: "me", sha256: sha, identity: null }, rows);
    expect(r).toEqual({ verdict: "exact_duplicate", exactFileIds: ["d1"], sameIdentityIds: [], dismissedIds: ["d2"] });
  });
  it("same identity, different file -> possible duplicate", () => {
    const r = detectDuplicates({ profileId: "me", sha256: "c".repeat(64), identity: "rc|SYN10045|example-brokerage" }, rows);
    expect(r).toMatchObject({ verdict: "possible_duplicate", sameIdentityIds: ["d3"] });
  });
  it("new document; a malformed sha is ignored, not trusted", () => {
    expect(detectDuplicates({ profileId: "me", sha256: "zz", identity: null }, rows).verdict).toBe("new");
    expect(detectDuplicates({ profileId: "someone-new", sha256: sha, identity: null }, rows).verdict).toBe("new");
  });
  it("the document itself is not its own duplicate", () => {
    expect(detectDuplicates({ profileId: "me", sha256: "b".repeat(64), identity: null, excludeId: "d3" }, rows).verdict).toBe("new");
  });

  it("payroll line state", () => {
    const lines = [
      { settlement_id: "s1", load_id: "L1", is_adjustment: false, settlement_status: "approved", is_estimate: false },
      { settlement_id: "s2", load_id: "L2", is_adjustment: false, settlement_status: "draft", is_estimate: false },
      { settlement_id: "s3", load_id: "L3", is_adjustment: false, settlement_status: "voided", is_estimate: false },
      { settlement_id: "s4", load_id: "L4", is_adjustment: true, settlement_status: "paid", is_estimate: false },
      { settlement_id: "s5", load_id: "L5", is_adjustment: false, settlement_status: "approved", is_estimate: true },
    ];
    const none = new Set<string>();
    expect(loadPayrollState("L1", "settled", lines, none)).toEqual({ state: "finalized", settlementIds: ["s1"] });
    expect(loadPayrollState("L2", "ready_for_settlement", lines, none)).toEqual({ state: "on_draft", settlementIds: ["s2"] });
    expect(loadPayrollState("L3", "ready_for_settlement", lines, none)).toEqual({ state: "free" });
    expect(loadPayrollState("L4", "pending", lines, none)).toEqual({ state: "free" });
    expect(loadPayrollState("L5", "pending", lines, none)).toEqual({ state: "free" });
    expect(loadPayrollState("L6", "pending", lines, new Set(["L6"]))).toEqual({ state: "paid_by_paystub" });
    expect(loadPayrollState("L7", "Cancelled", lines, none)).toEqual({ state: "protected_status", status: "cancelled" });
    expect(blocksPayroll(loadPayrollState("L1", "settled", lines, none))).toBe(true);
    expect(blocksPayroll(loadPayrollState("L2", null, lines, none))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
const pad = (head: number[], n = 2048) => { const b = new Uint8Array(n); b.set(head); return b; };
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC = pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]); // ....ftypheic

describe("file sniffing + HEIC plan", () => {
  it("sniffs by bytes", () => {
    expect([PDF, JPG, PNG, HEIC, pad([1, 2, 3])].map(sniffFileType)).toEqual(["pdf", "jpeg", "png", "heic", "unknown"]);
  });
  it("HEIC: keep original, convert a JPEG for extraction", () => {
    expect(planUpload("image/heic", HEIC)).toEqual({ ok: true, original: { mime: "image/heic", keep: true }, extractionInput: { convert: true, from: "image/heic", to: "image/jpeg" }, declaredMismatch: false });
  });
  it("trusts bytes over the declared type and flags the mismatch", () => {
    expect(planUpload("image/jpeg", PDF)).toMatchObject({ ok: true, original: { mime: "application/pdf" }, declaredMismatch: true });
  });
  it("rejects unsupported, tiny and oversized files", () => {
    expect(planUpload("application/zip", pad([0x50, 0x4b, 3, 4]))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(planUpload("image/png", PNG.slice(0, 100))).toEqual({ ok: false, reason: "too_small" });
    expect(planUpload("application/pdf", pad([0x25, 0x50, 0x44, 0x46, 0x2d], 20 * 1024 * 1024 + 1))).toEqual({ ok: false, reason: "too_large" });
  });
  it("conversion output must really be JPEG; failures are reported, not thrown", async () => {
    expect(await convertForExtraction(HEIC, { toJpeg: async () => JPG })).toEqual({ ok: true, jpeg: JPG });
    expect(await convertForExtraction(HEIC, { toJpeg: async () => PNG })).toEqual({ ok: false, reason: "output_not_jpeg" });
    expect(await convertForExtraction(HEIC, { toJpeg: async () => { throw new Error("decoder missing"); } })).toEqual({ ok: false, reason: "converter_failed", detail: "decoder missing" });
    expect(await convertForExtraction(JPG, { toJpeg: async () => JPG })).toEqual({ ok: false, reason: "not_heic" });
  });
});
