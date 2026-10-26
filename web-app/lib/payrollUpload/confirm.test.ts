import { describe, expect, it, vi } from "vitest";
import { confirmPayrollDraft, type ConfirmDeps } from "./confirm";
import { payrollConfirmGate } from "./featureFlag";
import * as fx from "./fixtures";
import { DOC, DRAFT, DRIVER, LOAD, NEW_DRAFT, OTHER, OWNER, PROFILE, doc, draft, input } from "./proposal.test-helpers";
import type { ProposalDocument } from "./proposal";

const LOCAL = payrollConfirmGate({ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
const USER = { id: OWNER, email: "owner@example.test" };
const CLAIM = "c1a1c1a1-0000-4000-8000-000000000001";
const TOKEN = "70c0e000-0000-4000-8000-000000000001";
const LINE = "11e00000-0000-4000-8000-000000000001";

function deps(over: Partial<ConfirmDeps> = {}, document: ProposalDocument = doc(), extra: Parameters<typeof input>[0] = {}): ConfirmDeps & { calls: string[] } {
  const calls: string[] = [];
  const d: ConfirmDeps = {
    gate: LOCAL,
    now: () => new Date("2026-10-24T18:00:00Z"),
    getProfile: vi.fn(async () => { calls.push("getProfile"); return PROFILE; }),
    getDocument: vi.fn(async () => { calls.push("getDocument"); return document; }),
    proposalInput: vi.fn(async (doc_, _p, decisions) => { calls.push("proposalInput"); return input({ document: doc_, decisions, ...extra }); }),
    createDraft: vi.fn(async () => { calls.push("createDraft"); return { ok: true as const, id: DRAFT }; }),
    addLoadToDraft: vi.fn(async () => { calls.push("addLoadToDraft"); return { ok: true as const }; }),
    recover: vi.fn(async () => { calls.push("recover"); return { ok: true as const, state: "none" as const }; }),
    claim: vi.fn(async () => { calls.push("claim"); return { ok: true as const, claimId: CLAIM, claimToken: TOKEN }; }),
    releaseClaim: vi.fn(async () => { calls.push("releaseClaim"); }),
    finalizeClaim: vi.fn(async () => { calls.push("finalizeClaim"); return { ok: true as const, settlementLoadId: LINE }; }),
    ...over,
  };
  return Object.assign(d, { calls });
}

describe("confirmation gate (disabled for production)", () => {
  it("off by default: refuses before reading or writing anything", async () => {
    const d = deps({ gate: payrollConfirmGate({}) });
    const r = await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT });
    expect(r).toMatchObject({ ok: false, code: "confirm_disabled" });
    expect(d.calls).toEqual([]);
  });
  it("production URL stays disabled even with the flag set", async () => {
    const d = deps({ gate: payrollConfirmGate({ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "https://rmzqxsfhjqrshhdjzhze.supabase.co" }) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "confirm_disabled" });
    expect(d.calls).toEqual([]);
  });
});

describe("permissions", () => {
  it.each([
    ["driver account", { account_type: "driver" }],
    ["dispatcher role", { account_role: "dispatcher" }],
    ["driver role", { account_role: "driver" }],
  ])("%s is refused before the document is read", async (_n, over) => {
    const d = deps({ getProfile: vi.fn(async () => ({ ...PROFILE, ...over })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "not_owner" });
    expect(d.getDocument).not.toHaveBeenCalled();
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("a profile that isn't the signed-in user's is refused", async () => {
    const d = deps({ getProfile: vi.fn(async () => ({ ...PROFILE, id: OTHER })) });
    expect(await confirmPayrollDraft(d, USER, DOC, {})).toMatchObject({ code: "not_owner" });
  });
  it("another account's document is 'not found' and nothing is written", async () => {
    const d = deps({}, doc(undefined, { profile_id: OTHER }));
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "not_found" });
    expect(d.createDraft).not.toHaveBeenCalled();
  });
});

describe("draft preparation through the existing settlement actions", () => {
  it("create: calls createSettlementAction with exactly the matched load, then records the confirmation", async () => {
    const d = deps();
    const r = await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT }, "2026-10-24");
    expect(r).toEqual({ ok: true, settlementId: DRAFT, created: true, settlementLoadId: LINE });
    expect(d.createDraft).toHaveBeenCalledWith({ driverId: DRIVER, periodStart: "2026-10-12", periodEnd: "2026-10-18", loadIds: [LOAD], applyRecurring: false, hoursWorked: "", clientToday: "2026-10-24" });
    expect(d.addLoadToDraft).not.toHaveBeenCalled();
    expect(d.claim).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC, loadId: LOAD, plan: "create", targetSettlementId: null }));
    expect(d.finalizeClaim).toHaveBeenCalledWith({ claimId: CLAIM, claimToken: TOKEN }, DRAFT, expect.objectContaining({ plan: "create", load_id: LOAD, confirmed_by: OWNER, requested_at: "2026-10-24T18:00:00.000Z" }));
    expect(d.calls).toEqual(["getProfile", "getDocument", "recover", "proposalInput", "claim", "createDraft", "finalizeClaim"]);
  });
  it("add to an existing draft: passes the draft's version for the conflict check", async () => {
    const d = deps({}, doc(), { drafts: [draft()] });
    const r = await confirmPayrollDraft(d, USER, DOC, { target: { kind: "existing_draft", settlementId: DRAFT } });
    expect(r).toEqual({ ok: true, settlementId: DRAFT, created: false, settlementLoadId: LINE });
    expect(d.addLoadToDraft).toHaveBeenCalledWith(DRAFT, "2026-10-20T10:00:00.123456+00:00", LOAD);
    expect(d.claim).toHaveBeenCalledWith(expect.objectContaining({ plan: "add_to_draft", targetSettlementId: DRAFT }));
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("the proposal is rebuilt on the server: unresolved review refuses with no write", async () => {
    const d = deps();
    const r = await confirmPayrollDraft(d, USER, DOC, {}); // no target chosen
    expect(r).toMatchObject({ ok: false, code: "not_ready" });
    expect(d.createDraft).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
  });
  it("reference-only documents can never be confirmed", async () => {
    const d = deps({}, doc(fx.OWN_STATEMENT));
    const r = await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT });
    expect(r.ok).toBe(false);
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("a blocked load (paid elsewhere) is refused with the database's reason", async () => {
    const d = deps({}, doc(), { paymentConflicts: new Map([[LOAD, "load_on_issued_paystub"]]) });
    const r = await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT });
    expect(r).toMatchObject({ ok: false, code: "payment:load_on_issued_paystub" });
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("if the settlement action refuses, the claim is released at once and nothing is linked", async () => {
    const d = deps({ createDraft: vi.fn(async () => ({ ok: false as const, error: "1 selected load is not payable yet" })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "draft_refused", error: "1 selected load is not payable yet" });
    expect(d.releaseClaim).toHaveBeenCalledWith({ claimId: CLAIM, claimToken: TOKEN }, "save_refused");
    expect(d.finalizeClaim).not.toHaveBeenCalled();
  });
  it("add-to-draft refusal (version conflict) also releases the claim", async () => {
    const d = deps({ addLoadToDraft: vi.fn(async () => ({ ok: false as const, error: "This settlement changed in another tab." })) }, doc(), { drafts: [draft()] });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: { kind: "existing_draft", settlementId: DRAFT } })).toMatchObject({ code: "draft_refused" });
    expect(d.releaseClaim).toHaveBeenCalledTimes(1);
  });
  it("document link failure is reported (draft stays editable; claim kept for recovery)", async () => {
    const d = deps({ finalizeClaim: vi.fn(async () => ({ ok: false as const, code: "document_already_linked", error: "already linked" })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "draft_saved_link_failed" });
    expect(d.releaseClaim).not.toHaveBeenCalled();
  });
  it("a claim refused by the database (other tab / same load) writes nothing", async () => {
    const d = deps({ claim: vi.fn(async () => ({ ok: false as const, code: "claim_conflict", error: "being confirmed in another tab" })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "claim_conflict" });
    expect(d.createDraft).not.toHaveBeenCalled();
    expect(d.addLoadToDraft).not.toHaveBeenCalled();
    expect(d.finalizeClaim).not.toHaveBeenCalled();
  });
  it("claim functions missing (migration not installed) => fails closed, no draft", async () => {
    const d = deps({ claim: vi.fn(async () => ({ ok: false as const, code: "claim_unavailable", error: "unavailable" })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "claim_unavailable" });
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("a network error during the save leaves the claim pending (no release, no link) and surfaces", async () => {
    const d = deps({ createDraft: vi.fn(async () => { throw new Error("fetch failed"); }) });
    await expect(confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).rejects.toThrow("fetch failed");
    expect(d.releaseClaim).not.toHaveBeenCalled();
    expect(d.finalizeClaim).not.toHaveBeenCalled();
  });
  it("an interrupted earlier attempt is recovered instead of creating a second draft", async () => {
    const d = deps({ recover: vi.fn(async () => ({ ok: true as const, state: "recovered" as const, settlementId: DRAFT, settlementLoadId: LINE, plan: "create" as const })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toEqual({ ok: true, settlementId: DRAFT, settlementLoadId: LINE, created: true, recovered: true });
    expect(d.proposalInput).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("ambiguous recovery stops for a human decision", async () => {
    const d = deps({ recover: vi.fn(async () => ({ ok: true as const, state: "ambiguous" as const })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "recovery_ambiguous" });
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("recover reports 'linked' (another tab just finished) => already confirmed", async () => {
    const d = deps({ recover: vi.fn(async () => ({ ok: true as const, state: "linked" as const, settlementId: DRAFT })) });
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "already_confirmed" });
    expect(d.claim).not.toHaveBeenCalled();
  });
  it("a second confirm of the same document is refused (already confirmed)", async () => {
    const d = deps({}, doc(undefined, { settlement_id: DRAFT }));
    expect(await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT })).toMatchObject({ ok: false, code: "already_confirmed" });
    expect(d.createDraft).not.toHaveBeenCalled();
  });
  it("records the owner's corrections and acknowledgements in the audit record", async () => {
    const d = deps({}, doc(fx.RATE_CON_BAD_EVIDENCE));
    const r = await confirmPayrollDraft(d, USER, DOC, { target: NEW_DRAFT, corrections: { total_revenue: { value: "2450.00", note: "misread" } } });
    expect(r.ok).toBe(true);
    const rec = (d.finalizeClaim as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(rec.corrections).toEqual([{ field: "total_revenue", extracted: 2540, saved: 2450, source: "manual" }]);
  });
});
