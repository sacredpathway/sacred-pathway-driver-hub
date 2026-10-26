import { describe, expect, it } from "vitest";
import {
  applyProposal,
  approveDocument,
  dismissDocument,
  processDocument,
  retryDocument,
  reviseDocument,
  undoAction,
} from "./pipeline";
import {
  addDoc,
  addDriver,
  addLoad,
  CDL,
  createFakeRepo,
  FUEL,
  newState,
  OTHER,
  OWNER,
  RATE_CON,
} from "./fakeRepo.test-helpers";

function setup() {
  const st = newState();
  const repo = createFakeRepo(st);
  return { st, repo };
}

const strongLoad = (st: ReturnType<typeof newState>, over = {}) =>
  addLoad(st, {
    load_number: "RC-1001",
    broker_name: "TQL",
    pickup_date: "2026-09-28",
    delivery_date: "2026-09-30",
    origin: "Dallas, TX",
    destination: "Atlanta, GA",
    total_revenue: 2400,
    ...over,
  });

describe("website upload -> extraction trigger", () => {
  it("a pending web upload is claimed, sent to the v2 extractor and routed", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st, { document_type: "rate_confirmation" }); // upload-time hint
    const load = strongLoad(st);
    st.modelOutput.set(doc.id, RATE_CON());
    const out = await processDocument(repo, doc.id);
    expect(st.extractorCalls).toEqual([{ id: doc.id, hint: "rate_confirmation" }]);
    expect(out.state).toBe("auto_routed");
    expect(st.docs.get(doc.id)!.load_id).toBe(load.id);
    expect(st.docs.get(doc.id)!.review_status).toBe("auto_routed");
  });

  it("an in-flight extraction is not started twice", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st, { status: "processing", updated_at: "2026-10-01T11:59:00.000Z" });
    expect(await processDocument(repo, doc.id)).toEqual({ state: "busy" });
    expect(st.extractorCalls).toHaveLength(0);
  });

  it("a stale processing claim (crashed run) can be taken over", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st, { status: "processing", updated_at: "2026-10-01T11:00:00.000Z" });
    st.modelOutput.set(doc.id, FUEL());
    expect((await processDocument(repo, doc.id)).state).toBe("auto_routed");
  });

  it("iPhone / legacy rows (v1, processed or manual) are never re-read by the web", async () => {
    const { st, repo } = setup();
    const ios = addDoc(st, { status: "processed", source: null, extraction_version: null });
    expect(await processDocument(repo, ios.id)).toEqual({ state: "skipped", reason: "not_v2" });
    expect(st.extractorCalls).toHaveLength(0);
  });
});

describe("extraction failure + retry", () => {
  it("failure keeps the document, marks it failed and is retryable", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.extractorFails.set(doc.id, "provider timeout");
    expect(await processDocument(repo, doc.id)).toEqual({ state: "failed", message: "provider timeout" });
    expect(st.docs.get(doc.id)).toMatchObject({ status: "failed", error_message: "provider timeout" });

    st.extractorFails.delete(doc.id);
    st.modelOutput.set(doc.id, FUEL());
    const again = await retryDocument(repo, doc.id);
    expect(again.state).toBe("auto_routed");
    expect(st.expenses).toHaveLength(1);
  });

  it("retry is refused while an applied action is live (no double action)", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    await approveOrNoop();
    expect(await retryDocument(repo, doc.id)).toMatchObject({ state: "refused" });
    expect(st.expenses).toHaveLength(1);
    async function approveOrNoop() {}
  });
});

describe("idempotency + duplicates", () => {
  it("processing the same document twice creates ONE expense", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    expect(await processDocument(repo, doc.id)).toEqual({ state: "skipped", reason: "already_routed" });
    expect(st.expenses).toHaveLength(1);
    expect(st.extractorCalls).toHaveLength(1);
  });

  it("an expense already created by an earlier crashed run is reused, not duplicated", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    const d = st.docs.get(doc.id)!;
    const res = await applyProposal(repo, d, d.routing!.proposed!, "automatic");
    expect(res.ok).toBe(true);
    expect(st.expenses).toHaveLength(1);
  });

  it("a duplicate upload (same hash) is not extracted and waits in review", async () => {
    const { st, repo } = setup();
    const first = addDoc(st, { content_sha256: "a".repeat(64) });
    const dup = addDoc(st, { content_sha256: "a".repeat(64), duplicate_of: first.id });
    expect(await processDocument(repo, dup.id)).toEqual({ state: "skipped", reason: "duplicate" });
    expect(st.extractorCalls).toHaveLength(0);
  });

  it("a matching manual expense blocks automatic creation (possible duplicate)", async () => {
    const { st, repo } = setup();
    st.expenses.push({ id: "manual", profile_id: OWNER, amount: 412.18, receipt_date: "2026-09-29", vendor_name: "Pilot Travel Center", source_document_id: null });
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("needs_review");
    expect(st.expenses).toHaveLength(1);
  });
});

describe("rate confirmations never create loads automatically", () => {
  it("unmatched high-confidence rate con -> review, zero loads, create_load proposal", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("needs_review");
    expect(st.loads).toHaveLength(0);
    expect(st.docs.get(doc.id)!.routing!.proposed).toEqual({ kind: "create_load" });
    // And approving cannot sneak one in.
    expect(await approveDocument(repo, doc.id)).toEqual({ ok: false, error: "Use Create load to add this load." });
    const p = await applyProposal(repo, st.docs.get(doc.id)!, { kind: "create_load" }, "human_approved");
    expect(p.ok).toBe(false);
    expect(st.loads).toHaveLength(0);
  });
});

describe("review queue (human actions)", () => {
  it("medium confidence -> review; human picks the load and approves", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    const load = strongLoad(st);
    st.modelOutput.set(doc.id, RATE_CON({ confidence: "medium" }));
    expect((await processDocument(repo, doc.id)).state).toBe("needs_review");
    expect(st.docs.get(doc.id)!.load_id).toBeNull(); // nothing applied yet
    const ok = await approveDocument(repo, doc.id);
    expect(ok.ok).toBe(true);
    expect(st.docs.get(doc.id)).toMatchObject({ load_id: load.id, review_status: "approved" });
    expect(st.docs.get(doc.id)!.routing!.applied[0].mode).toBe("human_approved");
  });

  it("revise (type + chosen driver) re-proposes but applies nothing", async () => {
    const { st, repo } = setup();
    const drv = addDriver(st, { name: "Demarquis Hinton", cdl_number: null });
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, CDL({ license_number: null }));
    await processDocument(repo, doc.id);
    expect(st.docs.get(doc.id)!.review_status).toBe("needs_review"); // name only -> weak
    const r = await reviseDocument(repo, doc.id, { driverId: drv.id, corrections: { expiration_date: "2029-05-31" } });
    expect(r.ok).toBe(true);
    expect(st.compliance).toHaveLength(0);
    expect(st.docs.get(doc.id)!.routing!.proposed).toMatchObject({ kind: "attach_driver_document", compliance: { driver_id: drv.id, expiration_date: "2029-05-31" } });
    expect((await approveDocument(repo, doc.id)).ok).toBe(true);
    expect(st.compliance).toHaveLength(1);
  });

  it("revise rejects an unknown type; dismiss applies nothing", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, { document_type: "other", confidence: "low" });
    await processDocument(repo, doc.id);
    expect(await reviseDocument(repo, doc.id, { type: "passport" })).toEqual({ ok: false, error: "Unknown document type." });
    expect((await dismissDocument(repo, doc.id)).ok).toBe(true);
    expect(st.docs.get(doc.id)!.review_status).toBe("dismissed");
    expect(await processDocument(repo, doc.id)).toEqual({ state: "skipped", reason: "dismissed" });
  });
});

describe("payroll / financial safety", () => {
  it("receipt for a settled load -> review, no expense", async () => {
    const { st, repo } = setup();
    strongLoad(st, { status: "settled" });
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL({ load_number: "RC-1001" }));
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("needs_review");
    expect(st.docs.get(doc.id)!.routing!.reasons).toContain("load_protected");
    expect(st.expenses).toHaveLength(0);
  });

  it("approval re-checks protection: a load paid after the proposal blocks approval", async () => {
    const { st, repo } = setup();
    const load = strongLoad(st);
    const doc = addDoc(st, { load_id: null });
    st.modelOutput.set(doc.id, FUEL({ load_number: "RC-1001", receipt_date: "2026-09-29", confidence: "medium" }));
    await processDocument(repo, doc.id);
    st.paidLoads.add(load.id); // iPhone settlement approved in the meantime
    const res = await approveDocument(repo, doc.id);
    expect(res.ok).toBe(false);
    expect(st.expenses).toHaveLength(0);
  });
});

describe("cross-account isolation", () => {
  it("another account's document is invisible", async () => {
    const { st, repo } = setup();
    const foreign = addDoc(st, { profile_id: OTHER });
    expect(await processDocument(repo, foreign.id)).toEqual({ state: "skipped", reason: "not_found" });
    expect(await approveDocument(repo, foreign.id)).toEqual({ ok: false, error: "Document not found." });
  });

  it("a load of another account is never matched or attached (even if a query leaks it)", async () => {
    const { st, repo } = setup();
    const foreignLoad = strongLoad(st, { profile_id: OTHER });
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    await processDocument(repo, doc.id);
    expect(st.docs.get(doc.id)!.load_id).toBeNull();
    const res = await applyProposal(repo, st.docs.get(doc.id)!, { kind: "attach_load", load_id: foreignLoad.id }, "human_approved");
    expect(res).toMatchObject({ ok: false, reason: "load_not_found" });
  });

  it("malicious extracted identifiers cannot reach a query or a match", async () => {
    const { st, repo } = setup();
    strongLoad(st);
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON({ load_number: "RC-1001' OR '1'='1" }));
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("needs_review");
    expect(st.docs.get(doc.id)!.load_id).toBeNull();
  });
});

describe("audit + safe undo", () => {
  it("records source, action, target, confidence, mode and before/after", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    const a = st.docs.get(doc.id)!.routing!.applied[0];
    expect(a).toMatchObject({ kind: "create_expense", target_table: "expenses", mode: "automatic", before: null });
    expect(a.after).toMatchObject({ amount: 412.18, vendor_name: "Pilot #452" });
    expect(st.logs.find((l) => l.action === "auto_routed")!.metadata).toMatchObject({ document_id: doc.id, mode: "automatic", target_table: "expenses" });
  });

  it("undo deletes an unchanged auto expense and puts the document back in review", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    expect(await undoAction(repo, doc.id, 0)).toEqual({ ok: true });
    expect(st.expenses).toHaveLength(0);
    expect(st.docs.get(doc.id)).toMatchObject({ review_status: "needs_review" });
    expect(st.docs.get(doc.id)!.routing!.applied[0].undone_at).toBeTruthy();
    expect(await undoAction(repo, doc.id, 0)).toEqual({ ok: false, error: "Already undone." });
  });

  it("undo refuses when a human edited the record afterwards", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL());
    await processDocument(repo, doc.id);
    st.expenses[0].amount = 400; // later legitimate human change
    expect((await undoAction(repo, doc.id, 0)).ok).toBe(false);
    expect(st.expenses).toHaveLength(1);
  });

  it("undo refuses for a load that became paid, and for docs in finalized settlements", async () => {
    const { st, repo } = setup();
    const load = strongLoad(st);
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, FUEL({ load_number: "RC-1001", receipt_date: "2026-09-29" }));
    await processDocument(repo, doc.id);
    expect(st.expenses[0].load_id).toBe(load.id);
    st.paidLoads.add(load.id);
    expect((await undoAction(repo, doc.id, 0)).ok).toBe(false);

    const rc = addDoc(st);
    st.modelOutput.set(rc.id, RATE_CON());
    await processDocument(repo, rc.id);
    st.finalizedSettlementDocs.add(rc.id);
    expect((await undoAction(repo, rc.id, 0)).ok).toBe(false);
    expect(st.docs.get(rc.id)!.load_id).toBe(load.id);
  });

  it("undo of an attachment restores the previous link only if unchanged", async () => {
    const { st, repo } = setup();
    const load = strongLoad(st);
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    await processDocument(repo, doc.id);
    expect(st.docs.get(doc.id)!.load_id).toBe(load.id);
    expect(await undoAction(repo, doc.id, 0)).toEqual({ ok: true });
    expect(st.docs.get(doc.id)!.load_id).toBeNull();
  });
});

describe("undo attach-load: approved/paid settlement protection (Step 5)", () => {
  /** A rate con auto-attached to a load, ready to be undone. */
  async function attached() {
    const { st, repo } = setup();
    const load = strongLoad(st);
    const rc = addDoc(st);
    st.modelOutput.set(rc.id, RATE_CON());
    await processDocument(repo, rc.id);
    expect(st.docs.get(rc.id)!.load_id).toBe(load.id);
    return { st, repo, load, rc };
  }

  it("an APPROVED settlement blocks undo attach-load and changes nothing", async () => {
    const { st, repo, load, rc } = await attached();
    st.settlementStatusByDoc.set(rc.id, "approved");
    const routingBefore = JSON.stringify(st.docs.get(rc.id)!.routing);
    const logsBefore = st.logs.length;
    expect(await undoAction(repo, rc.id, 0)).toEqual({ ok: false, error: "This document is part of an approved/paid settlement." });
    expect(st.docs.get(rc.id)!.load_id).toBe(load.id);
    expect(JSON.stringify(st.docs.get(rc.id)!.routing)).toBe(routingBefore);
    expect(st.logs.length).toBe(logsBefore);
  });

  it("a PAID settlement blocks undo attach-load and changes nothing", async () => {
    const { st, repo, load, rc } = await attached();
    st.settlementStatusByDoc.set(rc.id, "paid");
    expect(await undoAction(repo, rc.id, 0)).toEqual({ ok: false, error: "This document is part of an approved/paid settlement." });
    expect(st.docs.get(rc.id)!.load_id).toBe(load.id);
    expect(st.docs.get(rc.id)!.routing!.applied[0].undone_at ?? null).toBeNull();
  });

  it("a failed settlement check FAILS CLOSED: nothing undone, nothing logged", async () => {
    const { st, repo, load, rc } = await attached();
    st.settlementCheckError = "Could not embed because more than one relationship was found for 'settlement_loads' and 'settlements'";
    const routingBefore = JSON.stringify(st.docs.get(rc.id)!.routing);
    const logsBefore = st.logs.length;
    const r = await undoAction(repo, rc.id, 0);
    expect(r).toEqual({ ok: false, error: "Couldn't verify the document's settlement status; nothing undone. Try again." });
    expect(st.docs.get(rc.id)!.load_id).toBe(load.id);
    expect(JSON.stringify(st.docs.get(rc.id)!.routing)).toBe(routingBefore);
    expect(st.logs.length).toBe(logsBefore);
    // Once the check works again, the eligible undo proceeds.
    st.settlementCheckError = null;
    expect(await undoAction(repo, rc.id, 0)).toEqual({ ok: true });
  });

  for (const status of ["draft", "ready_for_review", "voided"]) {
    it(`an eligible (${status}) settlement still allows undo attach-load`, async () => {
      const { st, repo, rc } = await attached();
      st.settlementStatusByDoc.set(rc.id, status);
      expect(await undoAction(repo, rc.id, 0)).toEqual({ ok: true });
      expect(st.docs.get(rc.id)!.load_id).toBeNull();
      expect(st.docs.get(rc.id)!.routing!.applied[0].undone_at).toBeTruthy();
    });
  }

  it("a document on no settlement still allows undo attach-load", async () => {
    const { st, repo, rc } = await attached();
    expect(await undoAction(repo, rc.id, 0)).toEqual({ ok: true });
    expect(st.docs.get(rc.id)!.load_id).toBeNull();
  });
});
