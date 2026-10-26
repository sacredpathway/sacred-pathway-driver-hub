import { describe, expect, it } from "vitest";
import { processDocument, rerouteWaitingForLoad, undoAction } from "./pipeline";
import { effectiveExtraction } from "./routing";
import { webExtractionVersion, isRoutableVersion } from "./versions";
import { addDoc, addLoad, createFakeRepo, FUEL, newState, OTHER, RATE_CON, storeExtractionV3, toV3Raw } from "./fakeRepo.test-helpers";
import { sanitizePayrollExtraction } from "./payrollExtraction";

const strong = { load_number: "RC-1001", broker_name: "TQL", pickup_date: "2026-09-28", delivery_date: "2026-09-30", origin: "Dallas, TX", destination: "Atlanta, GA", total_revenue: 2400 };
const POD = (over: Record<string, unknown> = {}) => ({ document_type: "pod", confidence: "high", load_number: "RC-1001", pickup_date: "2026-09-28", delivery_date: "2026-09-30", origin: "Dallas, TX", destination: "Atlanta, GA", signature_present: true, ...over });

describe("extraction version selection", () => {
  it("website asks for v3 only when explicitly enabled", () => {
    expect(webExtractionVersion({})).toBe("v2");
    expect(webExtractionVersion({ DOCUMENT_EXTRACTION_VERSION: "v3" })).toBe("v3");
    expect(webExtractionVersion({ DOCUMENT_EXTRACTION_VERSION: "v1" })).toBe("v2");
    expect(isRoutableVersion("v3")).toBe(true);
    expect(isRoutableVersion(null)).toBe(false);
  });
});

describe("one v3 read serves filing", () => {
  it("routing reads the v3 payroll extraction like v2 (same fields, not a parse failure)", () => {
    const stored = { ...sanitizePayrollExtraction(toV3Raw(RATE_CON({ driver_name: "Driver A" }))), parse_stage: "strict" };
    const { extraction, parseFailed } = effectiveExtraction(stored, null);
    expect(parseFailed).toBe(false);
    expect(extraction.document_type).toBe("rate_confirmation");
    expect(extraction.fields.load_number).toBe("RC-1001");
    expect(extraction.fields.total_revenue).toBe(2400);
    expect(extraction.fields).not.toHaveProperty("driver_name"); // payroll-only field stays out of filing
  });
  it("a failed v3 parse is never automatic", () => {
    const stored = { ...sanitizePayrollExtraction({}), parse_stage: "fallback" };
    expect(effectiveExtraction(stored, null).parseFailed).toBe(true);
  });
  it("process -> v3 extract -> auto-attach to the matching load", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    const load = addLoad(st, strong);
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("auto_routed");
    expect(st.docs.get(doc.id)!.extraction_version).toBe("v3");
    expect(st.docs.get(doc.id)!.load_id).toBe(load.id);
  });
  it("new types: scale ticket files as an expense, detention proof attaches to its load", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    const load = addLoad(st, strong);
    const scale = addDoc(st);
    st.modelOutput.set(scale.id, { document_type: "scale_ticket", confidence: "high", vendor_name: "CAT Scale", expense_amount: 13.5, receipt_date: "2026-09-29", load_number: "RC-1001" });
    const det = addDoc(st);
    st.modelOutput.set(det.id, POD({ document_type: "accessorial", accessorial_type: "detention", accessorial_amount: 75, detention_hours: 3, signature_present: undefined }));
    const repoNow = createFakeRepo(st, undefined, new Date("2026-10-01T12:00:00Z"));
    await processDocument(repoNow, scale.id);
    await processDocument(repo, det.id);
    expect(st.expenses.map((e) => [e.category, e.amount, e.load_id])).toEqual([["scale", 13.5, load.id]]);
    expect(st.docs.get(det.id)!.load_id).toBe(load.id);
  });
});

describe("documents that arrive before their load", () => {
  it("POD and fuel receipt wait; once the load exists they are filed automatically", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    const pod = addDoc(st);
    st.modelOutput.set(pod.id, POD());
    const fuel = addDoc(st);
    st.modelOutput.set(fuel.id, FUEL({ load_number: "RC-1001", receipt_date: "2026-09-29" }));
    expect((await processDocument(repo, pod.id)).state).toBe("needs_review");
    expect((await processDocument(repo, fuel.id)).state).toBe("needs_review");
    expect(st.docs.get(pod.id)!.routing!.reasons).toEqual(["load_not_found"]);

    const load = addLoad(st, strong); // e.g. created from the rate con
    const filed = await rerouteWaitingForLoad(repo, load.id);
    expect(filed.sort()).toEqual([fuel.id, pod.id].sort());
    expect(st.docs.get(pod.id)!.load_id).toBe(load.id);
    expect(st.docs.get(pod.id)!.review_status).toBe("auto_routed");
    expect(st.expenses).toHaveLength(1);
    expect(st.expenses[0].load_id).toBe(load.id);
    // idempotent: a second pass files nothing new and creates no second expense
    expect(await rerouteWaitingForLoad(repo, load.id)).toEqual([]);
    expect(st.expenses).toHaveLength(1);
  });
  it("never touches documents a human corrected, other loads' paperwork, or another carrier's", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    const corrected = addDoc(st);
    st.modelOutput.set(corrected.id, POD());
    await processDocument(repo, corrected.id);
    const d = st.docs.get(corrected.id)!;
    st.docs.set(corrected.id, { ...d, routing: { ...d.routing!, corrections: { load_number: "RC-1001" } } });
    const other = addDoc(st);
    st.modelOutput.set(other.id, POD({ load_number: "ZZ-9" }));
    await processDocument(repo, other.id);
    const foreign = addDoc(st, { profile_id: OTHER });
    storeExtractionV3(st, foreign.id, toV3Raw(POD()));
    st.docs.set(foreign.id, { ...st.docs.get(foreign.id)!, review_status: "needs_review", routing: { ...st.docs.get(other.id)!.routing!, reasons: ["load_not_found"] } });
    const load = addLoad(st, strong);
    expect(await rerouteWaitingForLoad(repo, load.id)).toEqual([]);
    expect(st.docs.get(corrected.id)!.load_id).toBeNull();
    expect(st.docs.get(other.id)!.load_id).toBeNull();
    expect(st.docs.get(foreign.id)!.load_id).toBeNull();
  });
  it("a weak match stays in review (rule unchanged: load number alone is not enough)", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    const pod = addDoc(st);
    st.modelOutput.set(pod.id, { document_type: "pod", confidence: "high", load_number: "RC-1001" });
    await processDocument(repo, pod.id);
    const load = addLoad(st, { load_number: "RC-1001" });
    expect(await rerouteWaitingForLoad(repo, load.id)).toEqual([]);
    expect(st.docs.get(pod.id)!.review_status).toBe("needs_review");
    expect(st.docs.get(pod.id)!.routing!.reasons).toContain("load_weak_match");
  });
});

describe("a document on a settlement keeps its load", () => {
  it("undo attach-load is refused once the document is on a settlement draft", async () => {
    const st = newState(); st.v3 = true;
    const repo = createFakeRepo(st);
    addLoad(st, strong);
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    await processDocument(repo, doc.id);
    st.docs.set(doc.id, { ...st.docs.get(doc.id)!, settlement_id: "99999999-0000-4000-8000-000000000001" });
    const r = await undoAction(repo, doc.id, 0);
    expect(r.ok).toBe(false);
    expect(st.docs.get(doc.id)!.load_id).not.toBeNull();
  });
});
