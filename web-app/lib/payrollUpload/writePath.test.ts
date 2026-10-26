// =============================================================================
//  End-to-end write path, with the REAL server actions and a fake Supabase:
//    confirmPayrollDraftAction -> confirmPayrollDraft -> createSettlementAction
//      -> saveSettlementAtomic -> rpc("sph_web_save_settlement", { p })
//  The exact JSON the app would send is captured and checked into
//    supabase/tests/smart_payroll_upload/generated/spu_create_payload.json
//  which supabase/tests/smart_payroll_upload/20_write_path.sql executes
//  against the real database function (local throwaway cluster only).
//  Regenerate: UPDATE_DB_FIXTURE=1 npx vitest run lib/payrollUpload/writePath.test.ts
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import * as fx from "./fixtures";

// ---- ids shared with the SQL fixture (tests/web_settlements/00_fixture.sql) ----
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const D1 = "aaaaaaaa-0000-0000-0000-00000000d001";
const LOAD = "aaaaaaaa-0000-0000-0000-0000000a3001";
const DOC = "dddddddd-0000-4000-8000-0000000000c1";

// Deterministic ids for the settlement + lines created by createSettlementAction.
let seq = 0;
vi.mock("@/lib/settlements/payrule", async (orig) => ({
  ...(await orig<typeof import("@/lib/settlements/payrule")>()),
  cryptoId: () => `5e000000-0000-4000-8000-${String(0xc000 + ++seq).padStart(12, "0")}`,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

const rateCon = {
  ...fx.RATE_CON_OK,
  fields: {
    ...fx.RATE_CON_OK.fields,
    load_number: { value: "SYN-30001", page: 1, source_text: "Load # SYN-30001", confidence: "high" },
    pickup_date: { value: "2026-10-13", page: 1, source_text: "PU 10/13/2026", confidence: "high" },
    delivery_date: { value: "2026-10-14", page: 1, source_text: "DEL 10/14/2026", confidence: "high" },
    line_haul_rate: { value: 1850, page: 1, source_text: "Line Haul $1,850.00", confidence: "high" },
    fuel_surcharge: { value: 0, page: 1, source_text: "FSC $0.00", confidence: "high" },
    accessorial_charges: { value: 0, page: 1, source_text: "Accessorials $0.00", confidence: "high" },
    total_revenue: { value: 1850, page: 1, source_text: "Total Carrier Pay $1,850.00", confidence: "high" },
    driver_name: { value: "Driver A1", page: 1, source_text: "Driver: Driver A1", confidence: "medium" },
    carrier_name: { value: "Carrier A", page: 1, source_text: "Carrier: Carrier A", confidence: "high" },
  },
};
const LOAD_ROW = {
  id: LOAD, profile_id: A, driver_id: D1, load_number: "SYN-30001", broker_name: "Example Brokerage Inc", broker_mc_number: "800123",
  pickup_date: "2026-10-13", delivery_date: "2026-10-14", origin: "Dallas, TX", destination: "Houston, TX", total_miles: 240, empty_miles: 0,
  line_haul_rate: 1850, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 1850, status: "ready_for_settlement",
};
const DOC_ROW = {
  id: DOC, profile_id: A, status: "processed", document_type: "rate_confirmation", extraction_version: "v3",
  extracted_data: { ...sanitizePayrollExtraction(rateCon), parse_stage: "strict", type_hint: null },
  content_sha256: "c1".repeat(32), review_status: "needs_review", duplicate_of: null, settlement_id: null, routing: null,
  storage_path: `${A}/${DOC}.pdf`, file_mime_type: "application/pdf", created_at: "2026-10-24T12:00:00Z",
};

interface Call { table: string; op: string; filters: unknown[][]; patch?: unknown; cols?: string }
const calls: Call[] = [];
const rpcCalls: { name: string; args: { p?: Record<string, unknown> } & Record<string, unknown> }[] = [];
let docRow: Record<string, unknown> = { ...DOC_ROW };

function table(t: string, q: Call): unknown[] {
  if (t === "profiles") return [{ id: A, company_name: "Carrier A", mc_number: null, dot_number: null, account_type: null, account_role: null, dispatcher_fee_percentage: 0, factoring_fee_percentage: 0, authority_fee: 0, maintenance_reserve: 0, pay_basis: null }];
  if (t === "documents") {
    if (q.op === "update") {
      const unlinked = docRow.settlement_id === null;
      if (!unlinked) return [];
      docRow = { ...docRow, ...(q.patch as object) };
      return [{ id: DOC }];
    }
    if (q.filters.some((f) => f[0] === "eq" && f[1] === "id")) return [docRow];
    return []; // no other v3 documents / same-sha uploads
  }
  if (t === "loads") return [LOAD_ROW];
  if (t === "drivers") {
    if (q.filters.some((f) => f[0] === "eq" && f[1] === "id")) {
      return [{ id: D1, profile_id: A, name: "Driver A1", truck_number: null, pay_percentage: 70, pay_type: "percent", flat_rate: null, pay_rule: null, settlement_type: null, pay_on_gross_revenue: true, lease_config: null }];
    }
    return [{ id: D1, profile_id: A, name: "Driver A1", cdl_number: null, cdl_state: null, active: true }];
  }
  return []; // settlements, settlement_loads, recurring_deductions, activity_log ...
}

function fakeClient() {
  const from = (t: string) => {
    const q: Call = { table: t, op: "select", filters: [] };
    calls.push(q);
    const b: Record<string, unknown> = {};
    const f = (name: string) => (...a: unknown[]) => { q.filters.push([name, ...a]); return b; };
    Object.assign(b, {
      select: (cols: string) => { if (q.op === "select") q.cols = cols; return b; },
      update: (patch: unknown) => { q.op = "update"; q.patch = patch; return b; },
      insert: (patch: unknown) => { q.op = "insert"; q.patch = patch; return b; },
      eq: f("eq"), neq: f("neq"), in: f("in"), is: f("is"), ilike: f("ilike"), not: f("not"), or: f("or"),
      limit: () => b, order: () => b,
      maybeSingle: async () => ({ data: table(t, q)[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: table(t, q), error: null }).then(res),
    });
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: A, email: "owner@example.com" } } }) },
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const p = (args.p ?? {}) as Record<string, string>;
      if (name === "sph_web_save_settlement") return { data: { settlement_id: p.settlement_id, updated_at: "2026-10-24T18:00:00.000001+00:00" }, error: null };
      // Phase 3 claim functions (real ones: supabase/tests/smart_payroll_upload/30_claims.sql)
      if (name === "sph_payroll_claim_recover") return { data: docRow.settlement_id ? { state: "linked", settlement_id: docRow.settlement_id } : { state: "none" }, error: null };
      if (name === "sph_payroll_claim") {
        if (docRow.settlement_id) return { data: null, error: { message: "This document is already linked to a settlement.", hint: "sph:document_already_linked", code: "P0001" } };
        return { data: { claim_id: "c1a1c1a1-0000-4000-8000-000000000001", claim_token: "70c0e000-0000-4000-8000-000000000001" }, error: null };
      }
      if (name === "sph_payroll_claim_finalize") {
        docRow = { ...docRow, settlement_id: p.settlement_id, review_status: "approved" };
        return { data: { settlement_id: p.settlement_id, settlement_load_id: "5e000000-0000-4000-8000-000000049156" }, error: null };
      }
      if (name === "sph_payroll_claim_release") return { data: true, error: null };
      return { data: [], error: null }; // sph_loads_payment_conflicts: no conflict
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }) }) },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));

const ENV = { SMART_PAYROLL_CONFIRM: process.env.SMART_PAYROLL_CONFIRM, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL };
beforeEach(() => { seq = 0; calls.length = 0; rpcCalls.length = 0; docRow = { ...DOC_ROW }; });
afterEach(() => { process.env.SMART_PAYROLL_CONFIRM = ENV.SMART_PAYROLL_CONFIRM; process.env.NEXT_PUBLIC_SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL; });

const decisions = { target: { kind: "new_draft", periodStart: "2026-10-12", periodEnd: "2026-10-18", applyRecurring: false }, acknowledged: ["driver:unmatched"] };
const REPO = join(__dirname, "..", "..", "..");
const FIXTURE = join(REPO, "supabase/tests/smart_payroll_upload/generated/spu_create_payload.json");

describe("real write path (fake database)", () => {
  it("gate off (default env): the confirm action writes nothing and calls no settlement function", async () => {
    delete process.env.SMART_PAYROLL_CONFIRM;
    const { confirmPayrollDraftAction } = await import("@/app/(app)/documents/[id]/payroll/actions");
    const r = await confirmPayrollDraftAction(DOC, decisions, "2026-10-24");
    expect(r).toMatchObject({ ok: false, code: "confirm_disabled" });
    expect(rpcCalls).toEqual([]);
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("local gate on: one DRAFT via the existing createSettlementAction; nothing approved or paid", async () => {
    process.env.SMART_PAYROLL_CONFIRM = "local-only";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const { confirmPayrollDraftAction } = await import("@/app/(app)/documents/[id]/payroll/actions");
    const r = await confirmPayrollDraftAction(DOC, decisions, "2026-10-24");
    expect(r).toMatchObject({ ok: true, created: true });

    const names = rpcCalls.map((c) => c.name);
    expect(names).toEqual(["sph_payroll_claim_recover", "sph_loads_payment_conflicts", "sph_payroll_claim", "sph_web_save_settlement", "sph_payroll_claim_finalize"]);
    expect(names).not.toContain("sph_web_transition_settlement");
    const p = rpcCalls[3].args.p!;
    // claim before the save, finalize after it, both with the same token
    expect(rpcCalls[2].args.p).toMatchObject({ document_id: DOC, load_id: LOAD, plan: "create", target_settlement_id: null });
    expect(rpcCalls[4].args.p).toMatchObject({ claim_token: "70c0e000-0000-4000-8000-000000000001", settlement_id: p.settlement_id });
    expect(p.mode).toBe("create");
    expect((p.loads as { load_id: string }[]).map((l) => l.load_id)).toEqual([LOAD]);
    expect(p.header).not.toHaveProperty("status");
    expect(p.header).not.toHaveProperty("approved_at");
    expect((p.audit as { action: string }[]).map((a) => a.action)).toEqual(["created", "load_added"]);

    // No direct table writes at all except the existing action's activity log:
    // the draft goes through sph_web_save_settlement, the document link through
    // sph_payroll_claim_finalize.
    const writes = calls.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`);
    expect(writes).toEqual(["insert:activity_log"]);
    expect(docRow).toMatchObject({ settlement_id: (r as { settlementId: string }).settlementId, review_status: "approved" });

    // Contract file for the database test.
    const json = JSON.stringify(p, null, 2) + "\n";
    if (process.env.UPDATE_DB_FIXTURE === "1") {
      mkdirSync(join(FIXTURE, ".."), { recursive: true });
      writeFileSync(FIXTURE, json);
    }
    expect(readFileSync(FIXTURE, "utf8")).toBe(json);
  });

  it("confirming the same document again is refused (no second draft)", async () => {
    process.env.SMART_PAYROLL_CONFIRM = "local-only";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const { confirmPayrollDraftAction } = await import("@/app/(app)/documents/[id]/payroll/actions");
    expect((await confirmPayrollDraftAction(DOC, decisions, "2026-10-24")).ok).toBe(true);
    const before = rpcCalls.filter((c) => c.name === "sph_web_save_settlement").length;
    const again = await confirmPayrollDraftAction(DOC, decisions, "2026-10-24");
    expect(again).toMatchObject({ ok: false, code: "already_confirmed" });
    expect(rpcCalls.filter((c) => c.name === "sph_payroll_claim").length).toBe(1);
    expect(rpcCalls.filter((c) => c.name === "sph_web_save_settlement").length).toBe(before);
  });

  it("the read-only refresh action never writes", async () => {
    const { refreshPayrollProposalAction } = await import("@/app/(app)/documents/[id]/payroll/actions");
    const r = await refreshPayrollProposalAction(DOC, decisions, "2026-10-24");
    expect(r.ok && r.proposal.status).toBe("ready");
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
    expect(rpcCalls.map((c) => c.name)).toEqual(["sph_loads_payment_conflicts"]);
  });
});
