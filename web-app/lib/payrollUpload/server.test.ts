import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addLoadToDraftVia, bundleToEditPayload, claimErrorOf, claimVia, finalizeClaimVia, readProposalInput, recoverVia, releaseClaimVia, CLAIM_UNAVAILABLE } from "./server";
import { makeConfirmDeps } from "./wire";
import { DOC, DRAFT, DRIVER, LOAD, OTHER, OWNER, PROFILE, doc, load } from "./proposal.test-helpers";
import * as fx from "./fixtures";

type Filter = [string, string, unknown];
interface Query { table: string; op: string; cols?: string; filters: Filter[]; patch?: unknown }

/** Minimal chainable fake of the supabase-js query builder. */
function fakeSupabase(handler: (q: Query) => unknown[] | { error: string }, rpc?: (name: string, args: unknown) => unknown[]) {
  const queries: Query[] = [];
  const run = (q: Query) => {
    const r = handler(q);
    return Array.isArray(r) ? { data: r, error: null } : { data: null, error: { message: r.error } };
  };
  const builder = (table: string) => {
    const q: Query = { table, op: "select", filters: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => { q.filters.push([name, String(args[0]), args[1]]); return b; };
    Object.assign(b, {
      select: (cols: string) => { if (q.op === "select") q.cols = cols; return b; },
      update: (patch: unknown) => { q.op = "update"; q.patch = patch; return b; },
      eq: chain("eq"), neq: chain("neq"), in: chain("in"), is: chain("is"), ilike: chain("ilike"),
      limit: () => b, order: () => b,
      maybeSingle: async () => { const r = run(q); return { data: Array.isArray(r.data) ? r.data[0] ?? null : null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run(q)).then(res, rej),
    });
    return b;
  };
  const client = {
    from: builder,
    rpc: vi.fn(async (name: string, args: unknown) => ({ data: rpc ? rpc(name, args) : [], error: null })),
  } as unknown as SupabaseClient;
  return { client, queries };
}

const has = (q: Query, op: string, col: string, v?: unknown) => q.filters.some(([o, c, val]) => o === op && c === col && (v === undefined || JSON.stringify(val) === JSON.stringify(v)));

describe("readProposalInput: owner-scoped reads", () => {
  it("every table query is filtered by the owner and conflicts come from the database function", async () => {
    const { client, queries } = fakeSupabase((q) => {
      if (q.table === "loads") return [load()];
      if (q.table === "drivers") return [{ id: DRIVER, profile_id: OWNER, name: "Test Driver One", cdl_number: null, cdl_state: null, active: true }];
      if (q.table === "settlement_loads") return [{ settlement_id: DRAFT, load_id: LOAD, is_adjustment: false, settlements: { status: "voided", is_estimate: false, profile_id: OWNER } }];
      if (q.table === "documents") return [{ id: "dddddddd-0000-4000-8000-000000000002", profile_id: OWNER, content_sha256: "f".repeat(64), review_status: null, duplicate_of: null, extraction_version: "v3", extracted_data: doc().extracted_data }];
      if (q.table === "settlements") return [];
      return [];
    }, () => [{ load_id: LOAD, conflict: "load_on_issued_paystub" }]);
    const inp = await readProposalInput(client, doc(), PROFILE, {}, "2026-10-24");
    for (const t of ["loads", "drivers", "settlement_loads", "documents", "settlements"]) {
      const qs = queries.filter((q) => q.table === t);
      expect(qs.length, t).toBeGreaterThan(0);
      for (const q of qs) expect(has(q, "eq", "profile_id", OWNER), `${t} scoped`).toBe(true);
    }
    expect(client.rpc).toHaveBeenCalledWith("sph_loads_payment_conflicts", { p_load_ids: [LOAD] });
    expect(inp.paymentConflicts.get(LOAD)).toBe("load_on_issued_paystub");
    expect(inp.settlementLines).toEqual([{ settlement_id: DRAFT, load_id: LOAD, is_adjustment: false, settlement_status: "voided", is_estimate: false }]);
    expect(inp.otherDocuments[0].document_identity).toBe("rc|SYN10045|brokerage-example");
    expect(inp.identity?.verified).toBe(true);
    // Candidate loads are found by the printed number only.
    expect(queries.find((q) => q.table === "loads")!.filters.some(([o]) => o === "ilike")).toBe(true);
  });
  it("only reads; no update or rpc other than the read-only conflict check", async () => {
    const { client, queries } = fakeSupabase(() => []);
    await readProposalInput(client, doc(), PROFILE, {}, "2026-10-24");
    expect(queries.every((q) => q.op === "select")).toBe(true);
  });
});

const SETTLEMENT_ROW = {
  id: DRAFT, profile_id: OWNER, driver_id: DRIVER, status: "draft", settlement_number: "SP-2026-0042",
  settlement_period_start: "2026-10-12", settlement_period_end: "2026-10-18", settlement_type: "company_driver",
  pay_rule: { components: [{ id: "00000000-0000-4000-8000-000000000001", kind: "percent_of_gross", label: "Percentage of Gross", percent: "27.5", mile_basis: "loaded" }] },
  pay_on_gross_revenue: true, updated_at: "2026-10-20T10:00:00.123456+00:00", is_estimate: false, engine_version: "settlement-engine/1.0",
};

describe("addLoadToDraftVia: the editor's 'add load' + saveSettlementAction", () => {
  const db = (row: Record<string, unknown>, lines: unknown[] = []) => fakeSupabase((q) => {
    if (q.table === "settlements") return [row];
    if (q.table === "settlement_loads") return lines;
    if (q.table === "loads") return [load()];
    return [];
  });
  it("appends the stored load as a new line and hands the editor payload to the save action", async () => {
    const { client } = db(SETTLEMENT_ROW);
    const save = vi.fn(async () => ({ ok: true as const }));
    expect(await addLoadToDraftVia(client, OWNER, save, DRAFT, SETTLEMENT_ROW.updated_at, LOAD)).toEqual({ ok: true });
    const [id, exp, payload] = save.mock.calls[0] as unknown as [string, string, ReturnType<typeof bundleToEditPayload>];
    expect(id).toBe(DRAFT);
    expect(exp).toBe(SETTLEMENT_ROW.updated_at);
    expect(payload.loadLines).toHaveLength(1);
    expect(payload.loadLines[0]).toMatchObject({ loadId: LOAD, loadNumber: "SYN-10045", linehaul: "2200", fuelSurcharge: "200", accessorials: "50", grossRateOverride: null });
    expect(payload.header.settlementNumber).toBe("SP-2026-0042");
  });
  it("refuses locked, foreign, or already-present loads without saving", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    expect(await addLoadToDraftVia(db({ ...SETTLEMENT_ROW, status: "approved" }).client, OWNER, save, DRAFT, null, LOAD)).toMatchObject({ ok: false });
    expect(await addLoadToDraftVia(db({ ...SETTLEMENT_ROW, profile_id: OTHER }).client, OWNER, save, DRAFT, null, LOAD)).toEqual({ ok: false, error: "Settlement not found." });
    const existing = [{ id: "f1000000-0000-4000-8000-000000000001", settlement_id: DRAFT, profile_id: OWNER, load_id: LOAD, is_adjustment: false, linehaul: 2200, sort_order: 0 }];
    expect(await addLoadToDraftVia(db(SETTLEMENT_ROW, existing).client, OWNER, save, DRAFT, null, LOAD)).toEqual({ ok: false, error: "This load is already on that settlement." });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("Phase 3 claim functions (database-enforced idempotency)", () => {
  const CLAIM = "c1a1c1a1-0000-4000-8000-000000000001";
  const TOKEN = "70c0e000-0000-4000-8000-000000000001";
  const LINE = "11e00000-0000-4000-8000-000000000001";
  const conf = { confirmed_by: OWNER, requested_at: "2026-10-24T18:00:00.000Z", plan: "create" as const, load_id: LOAD, corrections: [], acknowledged: ["driver:unmatched"] };
  function rpcClient(reply: (name: string, args: { p: Record<string, unknown> }) => { data?: unknown; error?: { message: string; hint?: string; code?: string } }) {
    const calls: { name: string; args: { p: Record<string, unknown> } }[] = [];
    const client = {
      rpc: vi.fn(async (name: string, args: { p: Record<string, unknown> }) => { calls.push({ name, args }); const r = reply(name, args); return { data: r.data ?? null, error: r.error ?? null }; }),
      from: () => { throw new Error("claim wrappers must not touch tables directly"); },
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it("claim sends document, load, plan, target and the confirmation record; returns the handle", async () => {
    const { client, calls } = rpcClient(() => ({ data: { claim_id: CLAIM, claim_token: TOKEN, expires_at: "x" } }));
    expect(await claimVia(client, { documentId: DOC, loadId: LOAD, plan: "create", targetSettlementId: null, confirmation: conf }))
      .toEqual({ ok: true, claimId: CLAIM, claimToken: TOKEN });
    expect(calls).toEqual([{ name: "sph_payroll_claim", args: { p: { document_id: DOC, load_id: LOAD, plan: "create", target_settlement_id: null, confirmation: conf } } }]);
  });
  it("claim refusal keeps the database's code (sph:<code> hint) and message", async () => {
    const { client } = rpcClient(() => ({ error: { message: "This document or load is being confirmed in another tab or request.", hint: "sph:claim_conflict", code: "P0001" } }));
    expect(await claimVia(client, { documentId: DOC, loadId: LOAD, plan: "create", targetSettlementId: null, confirmation: conf }))
      .toMatchObject({ ok: false, code: "claim_conflict", error: expect.stringContaining("another tab") });
  });
  it.each([
    [{ message: "Could not find the function public.sph_payroll_claim(p) in the schema cache", code: "PGRST202" }],
    [{ message: "function public.sph_payroll_claim(jsonb) does not exist", code: "42883" }],
  ])("migration not installed => FAILS CLOSED (%#)", async (err) => {
    const { client } = rpcClient(() => ({ error: err }));
    expect(await claimVia(client, { documentId: DOC, loadId: LOAD, plan: "create", targetSettlementId: null, confirmation: conf }))
      .toEqual({ ok: false, code: "claim_unavailable", error: CLAIM_UNAVAILABLE });
  });
  it("a malformed claim response is refused", async () => {
    const { client } = rpcClient(() => ({ data: { claim_id: "x" } }));
    expect((await claimVia(client, { documentId: DOC, loadId: LOAD, plan: "create", targetSettlementId: null, confirmation: conf })).ok).toBe(false);
  });
  it("release and finalize pass the token; finalize returns the settlement line", async () => {
    const { client, calls } = rpcClient((n) => (n === "sph_payroll_claim_finalize" ? { data: { settlement_id: DRAFT, settlement_load_id: LINE } } : { data: true }));
    await releaseClaimVia(client, { claimId: CLAIM, claimToken: TOKEN }, "save_refused");
    expect(await finalizeClaimVia(client, { claimId: CLAIM, claimToken: TOKEN }, DRAFT, conf)).toEqual({ ok: true, settlementLoadId: LINE });
    expect(calls.map((c) => [c.name, c.args.p.claim_token])).toEqual([["sph_payroll_claim_release", TOKEN], ["sph_payroll_claim_finalize", TOKEN]]);
    expect(calls[1].args.p).toMatchObject({ settlement_id: DRAFT, confirmation: conf });
  });
  it("recover maps every state; anything unexpected is an error", async () => {
    for (const [data, want] of [
      [{ state: "none" }, { ok: true, state: "none" }],
      [{ state: "ambiguous" }, { ok: true, state: "ambiguous" }],
      [{ state: "linked", settlement_id: DRAFT }, { ok: true, state: "linked", settlementId: DRAFT, settlementLoadId: undefined }],
      [{ state: "recovered", settlement_id: DRAFT, settlement_load_id: LINE }, { ok: true, state: "recovered", settlementId: DRAFT, settlementLoadId: LINE }],
      [{ state: "weird" }, { ok: false, code: "recover_failed" }],
    ] as const) {
      const { client } = rpcClient(() => ({ data }));
      expect(await recoverVia(client, DOC)).toMatchObject(want);
    }
  });
  it("claimErrorOf ignores hints that aren't sph codes", () => {
    expect(claimErrorOf({ message: "boom", hint: "something else" }, "x")).toEqual({ code: "x", error: "boom" });
  });
});

describe("makeConfirmDeps", () => {
  it("is gated by the environment and delegates drafts to the given settlement actions only", async () => {
    const createSettlementAction = vi.fn(async () => ({ ok: true as const, id: DRAFT }));
    const saveSettlementAction = vi.fn(async () => ({ ok: true as const }));
    const { client } = fakeSupabase(() => []);
    const off = makeConfirmDeps(client, OWNER, "2026-10-24", { createSettlementAction, saveSettlementAction }, {});
    expect(off.gate.enabled).toBe(false);
    const on = makeConfirmDeps(client, OWNER, "2026-10-24", { createSettlementAction, saveSettlementAction }, { SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(on.gate.enabled).toBe(true);
    await on.createDraft({ driverId: DRIVER, periodStart: "2026-10-12", periodEnd: "2026-10-18", loadIds: [LOAD], applyRecurring: false, hoursWorked: "" });
    expect(createSettlementAction).toHaveBeenCalledTimes(1);
    void fx;
  });
});
