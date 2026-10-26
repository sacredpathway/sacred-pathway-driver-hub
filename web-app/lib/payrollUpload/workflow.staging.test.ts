// =============================================================================
//  Smart Payroll Upload — STAGING acceptance test (synthetic accounts only).
//  PREPARED, NOT YET RUN. Requires an approved execution gate.
//
//  Drives the REAL server actions (refresh / confirm -> createSettlementAction
//  -> sph_web_save_settlement -> sph_payroll_claim*) through REAL supabase-js
//  clients signed in to the staging project aatkirzwuuegurdlmcpl, so
//  PostgREST, Auth, Storage, RLS, triggers and the claim functions all decide.
//  The v3 model call is NOT made: the extraction row update is written by the
//  synthetic owner with the real v3 sanitizer output (labelled synthetic).
//
//  Hard refusals (the test aborts before any request):
//    * URL must be exactly https://aatkirzwuuegurdlmcpl.supabase.co
//    * every account email must be @example.com and contain "sph-stg-spu"
//    * the production ref must not appear anywhere in the environment
//
//  Run (execution gate only):
//    SPU_STAGING=1 STAGING_ANON_KEY=… \
//    SPU_STG_A_EMAIL=… SPU_STG_A_PASSWORD=… SPU_STG_B_EMAIL=… SPU_STG_B_PASSWORD=… \
//    SPU_STG_DRIVER_EMAIL=… SPU_STG_DRIVER_PASSWORD=… \
//    npx vitest run lib/payrollUpload/workflow.staging.test.ts
// =============================================================================
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import { sha256Hex } from "../documents/upload";
import { STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF } from "./featureFlag";
import * as fx from "./fixtures";

const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const ENABLED = process.env.SPU_STAGING === "1";
const E = (k: string) => process.env[k] ?? "";
const RUN_TAG = `spu-stg-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;

type Who = "A" | "B" | "DRIVER";
const H = globalThis as unknown as { __stg: { clients: Partial<Record<Who, SupabaseClient>>; who: Who; faultOnce?: string } };
H.__stg = { clients: {}, who: "A" };

// The server actions call createClient() from @/lib/supabase/server; give them
// the signed-in staging client of the current actor (optionally with a one-shot
// client-side fault on one RPC, to simulate a request dying mid-way).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const h = (globalThis as unknown as { __stg: typeof H.__stg }).__stg;
    const c = h.clients[h.who]!;
    if (!h.faultOnce) return c;
    const name = h.faultOnce;
    return new Proxy(c, {
      get(t, p, r) {
        if (p !== "rpc") return Reflect.get(t, p, r);
        return (fn: string, args?: Record<string, unknown>) => {
          if (fn === name && h.faultOnce === name) {
            h.faultOnce = undefined;
            return Promise.resolve({ data: null, error: { message: "synthetic network failure (test)", code: "TEST", details: null, hint: null } });
          }
          return t.rpc(fn, args);
        };
      },
    });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

function assertSafeEnvironment() {
  const all = JSON.stringify(process.env);
  if (all.includes(PRODUCTION_PROJECT_REF)) throw new Error("REFUSED: the production project ref is present in the environment");
  if (E("NEXT_PUBLIC_SUPABASE_URL") !== STAGING_URL) throw new Error(`REFUSED: NEXT_PUBLIC_SUPABASE_URL must be exactly ${STAGING_URL}`);
  for (const k of ["SPU_STG_A_EMAIL", "SPU_STG_B_EMAIL", "SPU_STG_DRIVER_EMAIL"]) {
    const v = E(k);
    if (!/^sph-stg-spu-[a-z0-9-]+@example\.com$/.test(v)) throw new Error(`REFUSED: ${k} must be a synthetic sph-stg-spu-…@example.com account`);
  }
  if (!E("STAGING_ANON_KEY")) throw new Error("REFUSED: STAGING_ANON_KEY missing");
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createSupabase(STAGING_URL, E("STAGING_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}
const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
const ev = (value: unknown, source_text: string, confidence = "high") => ({ value, page: 1, source_text, confidence });

function rateCon(loadNumber: string, total: number) {
  return {
    ...fx.RATE_CON_OK,
    fields: {
      ...fx.RATE_CON_OK.fields,
      load_number: ev(loadNumber, `Load # ${loadNumber}`),
      carrier_name: ev("SPU Staging Carrier A", "Carrier: SPU Staging Carrier A"),
      carrier_mc_number: ev(null, "", "low"),
      pickup_date: ev("2026-10-13", "PU 10/13/2026"), delivery_date: ev("2026-10-14", "DEL 10/14/2026"),
      line_haul_rate: ev(total, `Line Haul $${total.toFixed(2)}`), fuel_surcharge: ev(0, "FSC $0.00"),
      accessorial_charges: ev(0, "Accessorials $0.00"), total_revenue: ev(total, `Total Carrier Pay $${total.toFixed(2)}`),
      driver_name: ev("SPU Staging Driver", "Driver: SPU Staging Driver", "medium"),
    },
  };
}

/** Real Storage upload + the same documents row registerUpload writes. */
async function upload(c: SupabaseClient, text: string): Promise<{ id: string; path: string }> {
  const owner = await uid(c);
  const id = crypto.randomUUID();
  const path = `${owner}/${id}.pdf`;
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% SYNTHETIC ${RUN_TAG} ${text}\n%%EOF\n`);
  const up = await c.storage.from("documents").upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up.error) throw new Error(`storage upload: ${up.error.message}`);
  const ins = await c.from("documents").insert({
    id, profile_id: owner, document_type: "rate_confirmation", storage_path: path, status: "pending", processed: false,
    source: "web", content_sha256: await sha256Hex(bytes), file_mime_type: "application/pdf", file_size: bytes.byteLength,
  });
  if (ins.error) throw new Error(`documents insert: ${ins.error.message}`);
  return { id, path };
}

/** Synthetic stand-in for the Edge Function's v3 row update (no model call). */
async function syntheticExtract(c: SupabaseClient, docId: string, model: unknown) {
  const s = sanitizePayrollExtraction(model);
  const { error } = await c.from("documents").update({
    status: "processed", processed: true, extraction_version: "v3", document_type: s.stored_document_type,
    extracted_data: { ...s, parse_stage: "strict", type_hint: "rate_confirmation", synthetic_test: RUN_TAG },
    confidence: s.model_confidence ?? "low", provider: "synthetic-test", model: "none",
  }).eq("id", docId);
  if (error) throw new Error(`synthetic extraction: ${error.message}`);
}

const actions = () => import("@/app/(app)/documents/[id]/payroll/actions");
const TARGET = { kind: "new_draft" as const, periodStart: "2026-10-12", periodEnd: "2026-10-18", applyRecurring: false };
async function reviewed(docId: string) {
  const { refreshPayrollProposalAction } = await actions();
  const first = await refreshPayrollProposalAction(docId, { target: TARGET }, "2026-10-24");
  if (!first.ok) throw new Error(first.error);
  return { target: TARGET, acknowledged: first.proposal.warnings.map((w) => w.key) };
}

describe.skipIf(!ENABLED)("Smart Payroll Upload — staging acceptance (synthetic)", () => {
  let A: SupabaseClient, B: SupabaseClient, D: SupabaseClient, anon: SupabaseClient;
  let driverId = "";
  const loads: Record<string, string> = {};

  beforeAll(async () => {
    assertSafeEnvironment();
    process.env.SMART_PAYROLL_CONFIRM = "staging-only";
    anon = createSupabase(STAGING_URL, E("STAGING_ANON_KEY"), { auth: { persistSession: false } });
    A = await signIn(E("SPU_STG_A_EMAIL"), E("SPU_STG_A_PASSWORD"));
    B = await signIn(E("SPU_STG_B_EMAIL"), E("SPU_STG_B_PASSWORD"));
    D = await signIn(E("SPU_STG_DRIVER_EMAIL"), E("SPU_STG_DRIVER_PASSWORD"));
    H.__stg.clients = { A, B, DRIVER: D };
    // Synthetic driver + loads for carrier A (tagged with RUN_TAG).
    const aId = await uid(A);
    const dr = await A.from("drivers").insert({ profile_id: aId, name: `SPU Staging Driver ${RUN_TAG}`, pay_percentage: 70, pay_type: "percent", active: true }).select("id").single();
    if (dr.error) throw new Error(dr.error.message);
    driverId = (dr.data as { id: string }).id;
    for (const [key, rev, status, withDriver] of [["L1", 1850, "ready_for_settlement", true], ["L2", 1200, "ready_for_settlement", true], ["L3", 900, "ready_for_settlement", true],
      ["L4", 1000, "ready_for_settlement", true], ["L5", 700, "ready_for_settlement", false], ["L6", 650, "cancelled", true], ["L7", 800, "ready_for_settlement", true]] as const) {
      const n = `SPU-${RUN_TAG}-${key}`.toUpperCase();
      const r = await A.from("loads").insert({ profile_id: aId, driver_id: withDriver ? driverId : null, load_number: n, broker_name: "Example Brokerage Inc",
        pickup_date: "2026-10-13", delivery_date: "2026-10-14", origin: "Dallas, TX", destination: "Houston, TX", total_miles: 240, empty_miles: 0,
        line_haul_rate: rev, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: rev, status }).select("id").single();
      if (r.error) throw new Error(r.error.message);
      loads[key] = n;
    }
  }, 60_000);
  afterAll(async () => { H.__stg.who = "A"; });

  it("S1 auth: anon can't read claims or call the claim functions; every account signs in", async () => {
    const r = await anon.from("document_payroll_claims").select("id").limit(1);
    expect(r.error ?? (r.data ?? []).length === 0).toBeTruthy();
    const c = await anon.rpc("sph_payroll_claim", { p: { document_id: crypto.randomUUID(), load_id: crypto.randomUUID(), plan: "create" } });
    expect(c.error).toBeTruthy();
  });

  it("S2 storage: own folder only; B can't read or overwrite A's object", async () => {
    const { path } = await upload(A, "storage-check");
    expect((await A.storage.from("documents").createSignedUrl(path, 60)).error).toBeNull();
    expect((await B.storage.from("documents").download(path)).error).toBeTruthy();
    const aId = await uid(A);
    const intoA = await B.storage.from("documents").upload(`${aId}/${crypto.randomUUID()}.pdf`, new Blob(["x"], { type: "application/pdf" }), { contentType: "application/pdf" });
    expect(intoA.error).toBeTruthy();
  });

  it("S3 gate off: confirmation writes nothing", async () => {
    H.__stg.who = "A";
    const { id } = await upload(A, "gate-off");
    await syntheticExtract(A, id, rateCon(loads.L7, 800));
    // Restore the gate even if an assertion or an application call throws, so
    // later scenarios never run with confirmation switched off (Step 3 D2).
    const originalGate = process.env.SMART_PAYROLL_CONFIRM;
    process.env.SMART_PAYROLL_CONFIRM = "";
    try {
      const { confirmPayrollDraftAction } = await actions();
      expect(await confirmPayrollDraftAction(id, await reviewed(id), "2026-10-24")).toMatchObject({ ok: false, code: "confirm_disabled" });
    } finally {
      if (originalGate === undefined) delete process.env.SMART_PAYROLL_CONFIRM;
      else process.env.SMART_PAYROLL_CONFIRM = originalGate;
    }
    expect(process.env.SMART_PAYROLL_CONFIRM).toBe("staging-only");
    expect((await A.from("document_payroll_claims").select("id").eq("document_id", id)).data).toEqual([]);
  });

  it("S4 upload -> synthetic extraction -> review -> confirm -> ONE draft (engine amount, traceable line)", async () => {
    H.__stg.who = "A";
    const { id } = await upload(A, "main");
    await syntheticExtract(A, id, rateCon(loads.L1, 1580)); // printed total disagrees with the stored 1850
    const { confirmPayrollDraftAction } = await actions();
    const r = await confirmPayrollDraftAction(id, await reviewed(id), "2026-10-24");
    expect(r).toMatchObject({ ok: true, created: true });
    if (!r.ok) return;
    const s = await A.from("settlements").select("status, gross_load_revenue, net_pay").eq("id", r.settlementId).single();
    expect(s.data).toMatchObject({ status: "draft" });
    expect(Number((s.data as { gross_load_revenue: number }).gross_load_revenue)).toBe(1850);
    const claim = await A.from("document_payroll_claims").select("status, settlement_id, settlement_load_id, document_snapshot").eq("document_id", id).single();
    expect(claim.data).toMatchObject({ status: "confirmed", settlement_id: r.settlementId, settlement_load_id: r.settlementLoadId });
    expect(await confirmPayrollDraftAction(id, await reviewed(id), "2026-10-24")).toMatchObject({ ok: false });
  }, 60_000);

  it("S5 isolation: B and the driver can't see, claim or confirm A's document", async () => {
    const { id } = await upload(A, "isolation");
    await syntheticExtract(A, id, rateCon(loads.L7, 800));
    expect((await B.from("documents").select("id").eq("id", id)).data).toEqual([]);
    expect((await B.from("document_payroll_claims").select("id")).data).toEqual([]);
    const c = await B.rpc("sph_payroll_claim", { p: { document_id: id, load_id: crypto.randomUUID(), plan: "create" } });
    expect(c.error?.hint).toBe("sph:document_not_found");
    const { confirmPayrollDraftAction } = await actions();
    H.__stg.who = "B";
    expect(await confirmPayrollDraftAction(id, { target: TARGET }, "2026-10-24")).toMatchObject({ ok: false, code: "not_found" });
    H.__stg.who = "DRIVER";
    expect(await confirmPayrollDraftAction(id, { target: TARGET }, "2026-10-24")).toMatchObject({ ok: false, code: "not_owner" });
    H.__stg.who = "A";
  });

  it("S6 direct REST writes to claims are refused (R1)", async () => {
    const aId = await uid(A);
    const ins = await A.from("document_payroll_claims").insert({ profile_id: aId, document_id: crypto.randomUUID(), load_id: crypto.randomUUID(), claim_token: crypto.randomUUID(), plan: "create", expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(ins.error).toBeTruthy();

    // Target a REAL claim row (Step 3 D3): an update matching 0 rows fires no
    // trigger and returns no error, which proves nothing.
    const { id: docId } = await upload(A, "direct-write");
    const loadRow = await A.from("loads").select("id").eq("load_number", loads.L4).single();
    expect(loadRow.error).toBeNull();
    const c = await A.rpc("sph_payroll_claim", { p: { document_id: docId, load_id: (loadRow.data as { id: string }).id, plan: "create" } });
    expect(c.error).toBeNull();
    const tok = c.data as { claim_id: string; claim_token: string };
    const before = await A.from("document_payroll_claims").select("*").eq("id", tok.claim_id);
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(1); // the row is visible and was actually selected
    expect(before.data![0]).toMatchObject({ id: tok.claim_id, profile_id: aId, document_id: docId, status: "pending" });

    // Forged release that bypasses sph_payroll_claim_release.
    const upd = await A.from("document_payroll_claims")
      .update({ status: "released", released_at: new Date().toISOString(), released_reason: "forged" })
      .eq("id", tok.claim_id).select("id");
    expect(upd.error).toBeTruthy();
    expect(`${upd.error?.hint ?? ""} ${upd.error?.code ?? ""} ${upd.error?.message ?? ""}`).toMatch(/claim_direct_write|42501/);
    expect(upd.data ?? []).toEqual([]);

    const del = await A.from("document_payroll_claims").delete().eq("id", tok.claim_id).select("id");
    expect(del.error).toBeTruthy();

    const after = await A.from("document_payroll_claims").select("*").eq("id", tok.claim_id);
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data); // unchanged, still present

    // Leave the claim in its normal end state through the legitimate function (history kept).
    expect((await A.rpc("sph_payroll_claim_release", { p: { ...tok, reason: "test_release" } })).data).toBe(true);
  });

  it("S7 concurrency: six tabs confirm one document at once -> exactly one draft", async () => {
    H.__stg.who = "A";
    const { id } = await upload(A, "six-tabs");
    await syntheticExtract(A, id, rateCon(loads.L2, 1200));
    const decisions = await reviewed(id);
    const { confirmPayrollDraftAction } = await actions();
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmPayrollDraftAction(id, decisions, "2026-10-24")));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const lines = await A.from("settlement_loads").select("settlement_id, loads!inner(load_number)").eq("loads.load_number", loads.L2);
    expect(new Set((lines.data ?? []).map((l) => (l as { settlement_id: string }).settlement_id)).size).toBe(1);
  }, 90_000);

  it("S8 concurrency: two documents for one load at once -> exactly one draft", async () => {
    const d1 = await upload(A, "same-load-1");
    const d2 = await upload(A, "same-load-2");
    await syntheticExtract(A, d1.id, rateCon(loads.L3, 900));
    await syntheticExtract(A, d2.id, rateCon(loads.L3, 900));
    const [r1, r2] = [await reviewed(d1.id), await reviewed(d2.id)];
    const { confirmPayrollDraftAction } = await actions();
    const out = await Promise.all([confirmPayrollDraftAction(d1.id, r1, "2026-10-24"), confirmPayrollDraftAction(d2.id, r2, "2026-10-24")]);
    expect(out.filter((x) => x.ok)).toHaveLength(1);
  }, 90_000);

  it("S9 retry: a released claim never blocks the retry", async () => {
    const { id } = await upload(A, "release");
    const loadRow = await A.from("loads").select("id").eq("load_number", loads.L4).single();
    const c = await A.rpc("sph_payroll_claim", { p: { document_id: id, load_id: (loadRow.data as { id: string }).id, plan: "create" } });
    expect(c.error).toBeNull();
    const tok = c.data as { claim_id: string; claim_token: string };
    expect((await A.rpc("sph_payroll_claim_release", { p: { ...tok, reason: "test_release" } })).data).toBe(true);
    const again = await A.rpc("sph_payroll_claim", { p: { document_id: id, load_id: (loadRow.data as { id: string }).id, plan: "create" } });
    expect(again.error).toBeNull();
    await A.rpc("sph_payroll_claim_release", { p: { ...(again.data as object), reason: "test_release" } });
  });

  it("S10 crash after the draft is saved: next attempt after expiry recovers the SAME draft", async () => {
    H.__stg.who = "A";
    const { id } = await upload(A, "crash");
    await syntheticExtract(A, id, rateCon(loads.L4, 1000));
    const decisions = await reviewed(id);
    const { confirmPayrollDraftAction } = await actions();
    H.__stg.faultOnce = "sph_payroll_claim_finalize";
    expect(await confirmPayrollDraftAction(id, decisions, "2026-10-24")).toMatchObject({ ok: false, code: "draft_saved_link_failed" });
    expect((await confirmPayrollDraftAction(id, decisions, "2026-10-24")).ok).toBe(false); // before expiry: no second draft
    await new Promise((r) => setTimeout(r, 125_000)); // real claim expiry (120 s)
    expect(await confirmPayrollDraftAction(id, decisions, "2026-10-24")).toMatchObject({ ok: true, recovered: true });
    const lines = await A.from("settlement_loads").select("settlement_id, loads!inner(load_number)").eq("loads.load_number", loads.L4);
    expect(new Set((lines.data ?? []).map((l) => (l as { settlement_id: string }).settlement_id)).size).toBe(1);
  }, 240_000);

  it("S11 validation: driverless and cancelled loads are blocked before any claim", async () => {
    for (const k of ["L5", "L6"] as const) {
      const { id } = await upload(A, `blocked-${k}`);
      await syntheticExtract(A, id, rateCon(loads[k], 700));
      const { confirmPayrollDraftAction } = await actions();
      expect((await confirmPayrollDraftAction(id, await reviewed(id), "2026-10-24")).ok).toBe(false);
      expect((await A.from("document_payroll_claims").select("id").eq("document_id", id)).data).toEqual([]);
    }
  });

  it("S12 deletion keeps audit history (R1)", async () => {
    const { id, path } = await upload(A, "delete-me");
    await syntheticExtract(A, id, rateCon(loads.L7, 800));
    const { confirmPayrollDraftAction } = await actions();
    const r = await confirmPayrollDraftAction(id, await reviewed(id), "2026-10-24");
    expect(r.ok).toBe(true);
    const before = await A.from("document_payroll_claims").select("id").eq("document_id", id).single();
    expect((await A.from("documents").delete().eq("id", id)).error).toBeNull();
    await A.storage.from("documents").remove([path]);
    const after = await A.from("document_payroll_claims").select("id, document_id, document_deleted_at, status, document_snapshot").eq("id", (before.data as { id: string }).id).single();
    expect(after.data).toMatchObject({ document_id: null, status: "confirmed" });
    expect((after.data as { document_deleted_at: string | null }).document_deleted_at).not.toBeNull();
    expect((after.data as { document_snapshot: { storage_path: string } }).document_snapshot.storage_path).toBe(path);
  }, 60_000);
});
