// =============================================================================
//  Smart Payroll Upload — END-TO-END local workflow on a REAL throwaway
//  Postgres (never a Supabase project):
//    upload (registerUpload) -> extraction (v3 sanitizer + the Edge Function's
//    row update) -> review (refreshPayrollProposalAction) -> proposal ->
//    confirmation (confirmPayrollDraftAction) -> settlement DRAFT
//  through the REAL server actions, createSettlementAction, the REAL
//  sph_web_save_settlement and the Phase 3 claim functions, with RLS on.
//  Synthetic documents only; the model call and file storage are simulated.
//
//  Skipped unless started by supabase/tests/smart_payroll_upload/e2e.sh
//  (it sets SPU_E2E_PGHOST / SPU_E2E_PGPORT / SPU_E2E_PG_MODULE).
// =============================================================================
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pgSupabase, runAs, type FakeStorage, type PgPoolLike } from "./pgSupabase.test-helpers";
import { registerUpload } from "../documents/upload";
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import * as fx from "./fixtures";

const ENABLED = !!process.env.SPU_E2E_PGHOST && !!process.env.SPU_E2E_PG_MODULE;
const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "owner-a@example.test" };
const B = { id: "bbbbbbbb-0000-0000-0000-000000000001", email: "owner-b@example.test" };
const D1 = "aaaaaaaa-0000-0000-0000-00000000d001";

const H = globalThis as unknown as { __spu: { pool: PgPoolLike | null; user: typeof A | null; storage: FakeStorage } };
H.__spu = { pool: null, user: A, storage: { objects: new Map() } };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const h = (globalThis as unknown as { __spu: typeof H.__spu }).__spu;
    return pgSupabase(h.pool!, h.user, h.storage);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

let pool: (PgPoolLike & { end(): Promise<void> }) | null = null;
const sql = async (text: string, params: unknown[] = []) => {
  const r = await runAs(pool!, null, `select to_json(x) as j from (${text}) x`, params);
  if (r.error) throw new Error(r.error.message);
  return r.data as Record<string, unknown> | null;
};
const exec = async (text: string) => {
  const r = await runAs(pool!, null, `${text}`, []);
  if (r.error) throw new Error(r.error.message);
};
const as = (u: typeof A | null) => { H.__spu.user = u; };

const ev = (value: unknown, source_text: string, confidence = "high") => ({ value, page: 1, source_text, confidence });
function rateCon(loadNumber: string, total: number, extra: Record<string, unknown> = {}) {
  return {
    ...fx.RATE_CON_OK,
    fields: {
      ...fx.RATE_CON_OK.fields,
      load_number: ev(loadNumber, `Load # ${loadNumber}`),
      carrier_name: ev("Carrier A", "Carrier: Carrier A"),
      carrier_mc_number: ev(null, "", "low"),
      pickup_date: ev("2026-10-13", "PU 10/13/2026"),
      delivery_date: ev("2026-10-14", "DEL 10/14/2026"),
      line_haul_rate: ev(total, `Line Haul $${total.toFixed(2)}`),
      fuel_surcharge: ev(0, "FSC $0.00"),
      accessorial_charges: ev(0, "Accessorials $0.00"),
      total_revenue: ev(total, `Total Carrier Pay $${total.toFixed(2)}`),
      driver_name: ev("Driver A1", "Driver: Driver A1", "medium"),
      ...extra,
    },
  };
}

/** 1. UPLOAD through the real registration code (storage simulated in memory). */
async function upload(name: string, text: string): Promise<string> {
  const supabase = pgSupabase(pool!, H.__spu.user, H.__spu.storage);
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% SYNTHETIC ${text}\n`).buffer as ArrayBuffer;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const r = await registerUpload({
    ownerId: H.__spu.user!.id,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    storeObject: async (path, file, type) => { await supabase.storage.from("documents").upload(path, file, { contentType: type }); return { error: null }; },
    removeObject: async (path) => { await supabase.storage.from("documents").remove([path]); },
    findByHash: async (hash) => {
      const { data } = await supabase.from("documents").select("id").eq("content_sha256", hash).limit(1);
      return (data as { id: string }[] | null)?.[0] ?? null;
    },
    insertDocument: async (row) => { const { error } = await supabase.from("documents").insert(row); return { error: error?.message ?? null }; },
  }, { name, type: "application/pdf", size: blob.size, blob, bytes }, "pdf", { typeHint: "rate_confirmation", loadId: null });
  if (!r.ok) throw new Error(r.error);
  return r.doc.id;
}

/** 2. EXTRACTION: the v3 post-processing + the same row update finishV3 makes (service role). */
async function extract(docId: string, modelOutput: unknown) {
  const s = sanitizePayrollExtraction(modelOutput);
  const extracted = { ...s, parse_stage: "strict", type_hint: "rate_confirmation" };
  await runAs(pool!, null, `update public.documents set status = 'processed', processed = true, extracted_data = $2::jsonb,
      confidence = $3, document_type = $4, provider = 'openai', model = 'gpt-4o-2024-08-06', extraction_version = 'v3', error_message = null
    where id = $1`, [docId, JSON.stringify(extracted), extracted.model_confidence ?? "low", s.stored_document_type]).then((r) => { if (r.error) throw new Error(r.error.message); });
}

async function actions() {
  return import("@/app/(app)/documents/[id]/payroll/actions");
}
const TARGET = { kind: "new_draft" as const, periodStart: "2026-10-12", periodEnd: "2026-10-18", applyRecurring: false };

/** 3+4. REVIEW: read the proposal, tick every warning (the owner's review), pick the target. */
async function review(docId: string) {
  const { refreshPayrollProposalAction } = await actions();
  const first = await refreshPayrollProposalAction(docId, { target: TARGET }, "2026-10-24");
  if (!first.ok) throw new Error(first.error);
  const acknowledged = first.proposal.warnings.map((w) => w.key);
  const second = await refreshPayrollProposalAction(docId, { target: TARGET, acknowledged }, "2026-10-24");
  if (!second.ok) throw new Error(second.error);
  return { first: first.proposal, proposal: second.proposal, decisions: { target: TARGET, acknowledged } };
}

describe.skipIf(!ENABLED)("Smart Payroll Upload — end-to-end on a throwaway Postgres", () => {
  beforeAll(async () => {
    const req = createRequire(process.env.SPU_E2E_PG_MODULE!);
    const { Pool } = req("pg") as { Pool: new (o: Record<string, unknown>) => PgPoolLike & { end(): Promise<void> } };
    pool = new Pool({ host: process.env.SPU_E2E_PGHOST, port: Number(process.env.SPU_E2E_PGPORT), user: "postgres", database: "postgres", max: 20 });
    H.__spu.pool = pool;
    process.env.SMART_PAYROLL_CONFIRM = "local-only";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    // Synthetic loads for carrier A (driver Driver A1, 70 %).
    for (const [n, rev, status, driver] of [
      ["SYN-50001", 1850, "ready_for_settlement", D1], ["SYN-50002", 1200, "ready_for_settlement", D1],
      ["SYN-50003", 900, "ready_for_settlement", D1], ["SYN-50004", 1000, "ready_for_settlement", D1],
      ["SYN-50005", 1100, "ready_for_settlement", D1], ["SYN-50006", 700, "ready_for_settlement", null],
      ["SYN-50007", 650, "cancelled", D1],
    ] as const) {
      await runAs(pool, null, `insert into public.loads (profile_id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, destination,
          total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status)
        values ($1, $2, $3, 'Example Brokerage Inc', '800123', '2026-10-13', '2026-10-14', 'Dallas, TX', 'Houston, TX', 240, 0, $4, 0, 0, $4, $5)`,
        [A.id, driver, n, rev, status]).then((r) => { if (r.error) throw new Error(r.error.message); });
    }
  });
  afterAll(async () => { await pool?.end(); });

  it("gate off: confirmation writes nothing", async () => {
    as(A);
    const id = await upload("gate.pdf", "gate");
    await extract(id, rateCon("SYN-50005", 1100));
    const saved = process.env.SMART_PAYROLL_CONFIRM;
    delete process.env.SMART_PAYROLL_CONFIRM;
    const { confirmPayrollDraftAction } = await actions();
    const r = await confirmPayrollDraftAction(id, (await review(id)).decisions, "2026-10-24");
    process.env.SMART_PAYROLL_CONFIRM = saved;
    expect(r).toMatchObject({ ok: false, code: "confirm_disabled" });
    expect(await sql(`select count(*)::int n from public.document_payroll_claims where document_id = $1`, [id])).toEqual({ n: 0 });
  });

  it("upload -> extraction -> review -> proposal -> confirm -> ONE draft, calculated by the existing engine, traceable to the line", async () => {
    as(A);
    const docId = await upload("rc-50001.pdf", "rate con SYN-50001");
    expect(H.__spu.storage.objects.has(`${A.id}/${docId}.pdf`)).toBe(true);
    expect(await sql(`select status, source, extraction_version from public.documents where id = $1`, [docId])).toEqual({ status: "pending", source: "web", extraction_version: null });

    // The printed total (1580) disagrees with the stored load (1850): reference only.
    await extract(docId, rateCon("SYN-50001", 1580));
    const { first, proposal, decisions } = await review(docId);
    expect(first.status).toBe("needs_input");                       // warnings not yet acknowledged
    expect(first.warnings.map((w) => w.key)).toContain("conflict:total_revenue");
    expect(proposal.status).toBe("ready");
    expect(proposal.canConfirm).toBe(true);
    expect(proposal.plan).toMatchObject({ kind: "create", driverId: D1 });

    const { confirmPayrollDraftAction } = await actions();
    const r = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(r).toMatchObject({ ok: true, created: true });
    if (!r.ok) return;

    const s = await sql(`select status, gross_load_revenue::float8 g, net_pay::float8 n, approved_at, paid_at from public.settlements where id = $1`, [r.settlementId]);
    expect(s).toEqual({ status: "draft", g: 1850, n: 1295, approved_at: null, paid_at: null }); // 70 % of the STORED 1850, not the extracted 1580
    const t = await sql(`select d.settlement_id, d.review_status, d.payroll_status, c.status, c.settlement_load_id, sl.load_id, l.load_number, l.status load_status
        from public.documents d join public.document_payroll_claims c on c.document_id = d.id
        join public.settlement_loads sl on sl.id = c.settlement_load_id join public.loads l on l.id = sl.load_id where d.id = $1`, [docId]);
    expect(t).toMatchObject({ settlement_id: r.settlementId, review_status: "approved", payroll_status: "confirmed", status: "confirmed", settlement_load_id: r.settlementLoadId, load_number: "SYN-50001", load_status: "ready_for_settlement" });
    const audit = await sql(`select string_agg(action, ',' order by timestamp) a from public.settlement_audit_events where settlement_id = $1`, [r.settlementId]);
    expect(audit).toEqual({ a: "created,load_added" });

    // confirming the same document again: refused, nothing new
    const again = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(again).toMatchObject({ ok: false, code: "already_confirmed" });
    expect(await sql(`select count(*)::int n from public.settlement_loads sl join public.loads l on l.id = sl.load_id where l.load_number = 'SYN-50001'`)).toEqual({ n: 1 });
  });

  it("six tabs confirm the same document at once -> exactly one draft", async () => {
    as(A);
    const docId = await upload("rc-50002.pdf", "rate con SYN-50002");
    await extract(docId, rateCon("SYN-50002", 1200));
    const { decisions } = await review(docId);
    const { confirmPayrollDraftAction } = await actions();
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmPayrollDraftAction(docId, decisions, "2026-10-24")));
    const ok = results.filter((x) => x.ok);
    expect(ok).toHaveLength(1);
    for (const x of results.filter((y) => !y.ok)) {
      expect(["claim_conflict", "already_confirmed", "document_already_linked", "load_on_settlement"]).toContain((x as { code: string }).code);
    }
    expect(await sql(`select count(*)::int n from public.settlement_loads sl join public.loads l on l.id = sl.load_id where l.load_number = 'SYN-50002'`)).toEqual({ n: 1 });
    expect(await sql(`select count(*)::int n from public.document_payroll_claims where document_id = $1 and status = 'confirmed'`, [docId])).toEqual({ n: 1 });
    expect(await sql(`select count(*)::int n from public.document_payroll_claims where document_id = $1 and status = 'pending'`, [docId])).toEqual({ n: 0 });
  });

  it("two different documents for the same load, confirmed at once -> exactly one draft", async () => {
    as(A);
    const d1 = await upload("rc-50003-a.pdf", "rate con SYN-50003 copy A");
    const d2 = await upload("rc-50003-b.pdf", "rate con SYN-50003 copy B (re-sent by broker)");
    await extract(d1, rateCon("SYN-50003", 900));
    await extract(d2, rateCon("SYN-50003", 900));
    const r1 = await review(d1);
    const r2 = await review(d2);
    const { confirmPayrollDraftAction } = await actions();
    const [x, y] = await Promise.all([confirmPayrollDraftAction(d1, r1.decisions, "2026-10-24"), confirmPayrollDraftAction(d2, r2.decisions, "2026-10-24")]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await sql(`select count(*)::int n from public.settlement_loads sl join public.loads l on l.id = sl.load_id where l.load_number = 'SYN-50003'`)).toEqual({ n: 1 });
  });

  it("a failed save releases the claim; the retry succeeds (no permanent block)", async () => {
    as(A);
    const docId = await upload("rc-50004.pdf", "rate con SYN-50004");
    await extract(docId, rateCon("SYN-50004", 1000));
    const { decisions } = await review(docId);
    // test-only fault injection: refuse the next settlement insert
    await exec(`create table if not exists public.e2e_fault (on_ boolean);
      create or replace function public.e2e_fault_fn() returns trigger language plpgsql as $$ begin
        if exists (select 1 from public.e2e_fault where on_) then raise exception 'synthetic outage'; end if; return new; end $$;
      drop trigger if exists e2e_fault on public.settlements;
      create trigger e2e_fault before insert on public.settlements for each row execute function public.e2e_fault_fn();
      grant select on public.e2e_fault to authenticated; insert into public.e2e_fault values (true);`);
    const { confirmPayrollDraftAction } = await actions();
    const failed = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(failed).toMatchObject({ ok: false, code: "draft_refused" });
    expect(await sql(`select status, released_reason from public.document_payroll_claims where document_id = $1`, [docId])).toEqual({ status: "released", released_reason: "save_refused" });
    await exec(`drop trigger e2e_fault on public.settlements; drop function public.e2e_fault_fn(); drop table public.e2e_fault;`);
    const retry = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(retry).toMatchObject({ ok: true, created: true });
  });

  it("request dies after the draft is saved (link step fails) -> next attempt recovers the SAME draft", async () => {
    as(A);
    const docId = await upload("rc-50005.pdf", "rate con SYN-50005");
    await extract(docId, rateCon("SYN-50005", 1100));
    const { decisions } = await review(docId);
    await exec(`revoke execute on function public.sph_payroll_claim_finalize(jsonb) from authenticated`);
    const { confirmPayrollDraftAction } = await actions();
    const broken = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    await exec(`grant execute on function public.sph_payroll_claim_finalize(jsonb) to authenticated`);
    expect(broken).toMatchObject({ ok: false, code: "draft_saved_link_failed" });
    expect(await sql(`select status from public.document_payroll_claims where document_id = $1`, [docId])).toEqual({ status: "pending" });

    // before expiry: a retry is refused (no second draft), after expiry: recovered
    const early = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(early.ok).toBe(false);
    await exec(`set local session_replication_role = replica;
      update public.document_payroll_claims set created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes'
       where document_id = '${docId}' and status = 'pending';`);
    const healed = await confirmPayrollDraftAction(docId, decisions, "2026-10-24");
    expect(healed).toMatchObject({ ok: true, recovered: true });
    expect(await sql(`select count(distinct sl.settlement_id)::int n from public.settlement_loads sl join public.loads l on l.id = sl.load_id where l.load_number = 'SYN-50005'`)).toEqual({ n: 1 });
    expect(await sql(`select routing->'history'->-1->>'event' e from public.documents where id = $1`, [docId])).toEqual({ e: "payroll_draft_recovered" });
  });

  it("payroll validation on the real data: missing driver and cancelled load are blocked before any claim", async () => {
    as(A);
    for (const [n, code] of [["SYN-50006", "load_has_no_driver"], ["SYN-50007", "load_cancelled"]] as const) {
      const id = await upload(`rc-${n}.pdf`, `rate con ${n}`);
      await extract(id, rateCon(n, 700));
      const { proposal, decisions } = await review(id);
      expect(proposal.canConfirm).toBe(false);
      expect(proposal.blockers.map((b) => b.code).join(",")).toContain(code);
      const { confirmPayrollDraftAction } = await actions();
      expect((await confirmPayrollDraftAction(id, decisions, "2026-10-24")).ok).toBe(false);
      expect(await sql(`select count(*)::int n from public.document_payroll_claims where document_id = $1`, [id])).toEqual({ n: 0 });
    }
  });

  it("the same file uploaded again is marked duplicate and can't be confirmed", async () => {
    as(A);
    const first = await upload("dup.pdf", "same bytes");
    await extract(first, rateCon("SYN-50005", 1100));
    const second = await upload("dup-again.pdf", "same bytes");
    expect(await sql(`select duplicate_of from public.documents where id = $1`, [second])).toEqual({ duplicate_of: first });
    const { confirmPayrollDraftAction } = await actions();
    const r = await confirmPayrollDraftAction(second, { target: TARGET }, "2026-10-24");
    expect(r.ok).toBe(false);
  });

  it("carrier B can't review or confirm carrier A's document", async () => {
    as(A);
    const id = await upload("rc-iso.pdf", "isolation");
    await extract(id, rateCon("SYN-50005", 1100));
    as(B);
    const { confirmPayrollDraftAction, refreshPayrollProposalAction } = await actions();
    expect(await refreshPayrollProposalAction(id, { target: TARGET }, "2026-10-24")).toMatchObject({ ok: false });
    expect(await confirmPayrollDraftAction(id, { target: TARGET }, "2026-10-24")).toMatchObject({ ok: false, code: "not_found" });
    expect(await sql(`select count(*)::int n from public.document_payroll_claims where document_id = $1`, [id])).toEqual({ n: 0 });
    as(A);
  });
});
