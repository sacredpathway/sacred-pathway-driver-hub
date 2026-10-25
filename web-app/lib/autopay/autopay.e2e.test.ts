// =============================================================================
//  Automatic upload -> paystub — END-TO-END acceptance on a REAL throwaway
//  Postgres (never a Supabase project). Drives the REAL server actions the
//  browser calls (uploadDocumentsAction, processDocumentAction,
//  createLoadFromDocumentAction, runAutoPayrollAction, transitionSettlement…)
//  through RLS as role `authenticated`, the real routing, the real Smart
//  Payroll claims and the real sph_web_save_settlement. Only the AI model and
//  file storage are simulated: the fake extractor answers from synthetic
//  fixtures exactly like Edge Function v22 writes a v3 extraction.
//
//  Started by supabase/tests/autopay/e2e.sh (sets SPU_E2E_*).
// =============================================================================
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pgSupabase, runAs, type FakeFunctions, type FakeStorage, type PgPoolLike } from "../payrollUpload/pgSupabase.test-helpers";
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import { displayCalculation } from "../settlements/workflow";
import { loadBundle } from "../settlements/server";
import { payrollResumeCandidates } from "../documents/resume";

const ENABLED = !!process.env.SPU_E2E_PGHOST && !!process.env.SPU_E2E_PG_MODULE;
const C = { id: "cccccccc-0000-0000-0000-000000000001", email: "owner-c@example.test" };
const E = { id: "eeeeeeee-0000-0000-0000-000000000001", email: "owner-e@example.test" };
const MARCUS = "cccccccc-0000-0000-0000-00000000d001"; // company driver 70 %
const TINA = "cccccccc-0000-0000-0000-00000000d002"; // owner-operator 88 %
const SAM = "cccccccc-0000-0000-0000-00000000d003"; // no pay rule

// ---------------------------------------------------------------------------
//  Synthetic documents: what the "model" reads from each file (flat values).
// ---------------------------------------------------------------------------
const CARRIER = { carrier_name: "Sacred Test Carrier LLC", carrier_mc_number: "MC777001" };
const RC = (n: string, total: number, extra: Record<string, unknown> = {}) => ({
  document_type: "rate_confirmation", confidence: "high", load_number: n, broker_name: "Blue Ridge Logistics", broker_mc_number: "500100",
  ...CARRIER, origin: "Dallas, TX", destination: "Houston, TX", pickup_date: "2026-10-13", delivery_date: "2026-10-14",
  total_miles: 240, line_haul_rate: total, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: total, ...extra,
});
const POD = (n: string, extra: Record<string, unknown> = {}) => ({
  document_type: "pod", confidence: "high", load_number: n, bol_number: `BOL-${n}`, shipper_name: "Acme Foods", receiver_name: "HEB DC",
  origin: "Dallas, TX", destination: "Houston, TX", pickup_date: "2026-10-13", delivery_date: "2026-10-14", signature_present: true, ...extra,
});
const BOL = (n: string) => ({ ...POD(n), document_type: "bol", signature_present: undefined });
const RECEIPT = (type: string, vendor: string, amount: number, n: string, date = "2026-10-14") => ({
  document_type: type, confidence: "high", vendor_name: vendor, expense_amount: amount, receipt_date: date, load_number: n, receipt_number: `R-${vendor.length}${amount}`,
});
const MODEL = new Map<string, Record<string, unknown>>([
  ["rc-1001", RC("SPA-1001", 1850, { driver_name: "Marcus Reed" })],
  ["rc-1001-rescan", RC("SPA-1001", 1850, { driver_name: "Marcus Reed", notes: "second scan" })],
  ["bol-1001", BOL("SPA-1001")],
  ["pod-1001", POD("SPA-1001")],
  ["lumper-1001", RECEIPT("lumper_fee", "Capstone Lumper", 150, "SPA-1001")],
  ["fuel-1001", RECEIPT("fuel_receipt", "Pilot Travel Center", 412.18, "SPA-1001")],
  ["pod-2002", POD("SPA-2002", { delivery_date: "2026-10-15", pickup_date: "2026-10-14", origin: "Tulsa, OK", destination: "Denver, CO" })],
  ["fuel-2002", RECEIPT("fuel_receipt", "Loves", 412.18, "SPA-2002", "2026-10-14")],
  ["toll-2002", RECEIPT("toll", "Kansas Turnpike", 18.25, "SPA-2002", "2026-10-14")],
  ["scale-2002", RECEIPT("scale_ticket", "CAT Scale", 13.5, "SPA-2002", "2026-10-14")],
  ["rc-2002", RC("SPA-2002", 2400, { driver_name: "Tina Alvarez", origin: "Tulsa, OK", destination: "Denver, CO", pickup_date: "2026-10-14", delivery_date: "2026-10-15", total_miles: 680 })],
  ["rc-3003-wrong-rate", RC("SPA-3003", 1580)],
  ["rc-4004", RC("SPA-4004", 1000)],
  ["rc-5005", RC("SPA-5005", 900)],
  ["rc-6006", RC("SPA-6006", 1200)],
  ["rc-7007", RC("SPA-7007", 1300, { pickup_date: "2026-10-20", delivery_date: "2026-10-21" })],
  ["rc-8008", RC("SPA-8008", 1400, { pickup_date: "2026-10-20", delivery_date: "2026-10-22" })],
  ["toll-1001-late", RECEIPT("toll", "NTTA", 9.75, "SPA-1001")],
]);
const FLAKY = new Set<string>(); // keys whose next extraction fails like a network error

function toV3Raw(flat: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k === "document_type" || k === "confidence" || k === "notes" || v === undefined) continue;
    fields[k] = { value: v, page: 1, source_text: `${k}: ${String(v)}`, confidence: "high" };
  }
  return { document_type: flat.document_type, confidence: flat.confidence, page_count: 1, fields, notes: flat.notes ?? "" };
}

// ---------------------------------------------------------------------------
//  Harness
// ---------------------------------------------------------------------------
const H = globalThis as unknown as { __ap: { pool: PgPoolLike | null; user: typeof C | null; storage: FakeStorage; fn: FakeFunctions | null } };
H.__ap = { pool: null, user: C, storage: { objects: new Map() }, fn: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const h = (globalThis as unknown as { __ap: typeof H.__ap }).__ap;
    return pgSupabase(h.pool!, h.user, h.storage, h.fn ?? undefined);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

let pool: (PgPoolLike & { end(): Promise<void> }) | null = null;
const as = (u: typeof C | null) => { H.__ap.user = u; };
async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await runAs(pool!, null, `select coalesce(json_agg(x), '[]'::json) as j from (${text}) x`, params);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as T[];
}
/** INSERT/UPDATE ... RETURNING -> first row. */
async function one<T>(text: string, params: unknown[] = []): Promise<T> {
  const r = await runAs(pool!, null, `with t as (${text}) select to_json(t) as j from t`, params);
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
async function exec(text: string, params: unknown[] = []) {
  const r = await runAs(pool!, null, text, params);
  if (r.error) throw new Error(r.error.message);
}

/** The simulated Edge Function: reads the stored file, "reads" it, writes the v3 row (service role). */
const fakeExtractor: FakeFunctions = async (name, body, uid) => {
  if (name !== "extract-document") return { data: null, error: { message: "unknown function" } };
  const [doc] = await q<{ id: string; profile_id: string; storage_path: string; retry_count: number | null; status: string }>(
    "select id, profile_id, storage_path, retry_count, status from public.documents where id = $1", [body.document_id]);
  if (!doc || doc.profile_id !== uid) return { data: { success: false, code: "AUTH_EXPIRED" }, error: null };
  const text = H.__ap.storage.objects.get(doc.storage_path)?.text ?? "";
  const key = /KEY:([a-z0-9-]+)/.exec(text)?.[1] ?? "";
  if (FLAKY.has(key)) { FLAKY.delete(key); return { data: null, error: { message: "network error" } }; }
  const flat = MODEL.get(key);
  if (!flat) return { data: { success: false, code: "UNKNOWN_SCAN_ERROR", message: "unreadable" }, error: null };
  if (body.extraction_version !== "v3") return { data: { success: false, code: "BAD_VERSION" }, error: null };
  const s = sanitizePayrollExtraction(toV3Raw(flat));
  const extracted = { ...s, parse_stage: "strict", type_hint: body.type_hint ?? null };
  await exec(`update public.documents set status = 'processed', processed = true, extracted_data = $2::jsonb, confidence = $3,
      document_type = $4, provider = 'openai', model = 'synthetic', extraction_version = 'v3', error_message = null where id = $1`,
    [doc.id, JSON.stringify(extracted), extracted.model_confidence ?? "low", s.stored_document_type]);
  return { data: { success: true, document_id: doc.id }, error: null };
};

const docs = () => import("@/app/(app)/documents/actions");
const settlements = () => import("@/app/(app)/settlements/actions");

/** What the browser does: upload the files, then process each new non-duplicate one. */
async function uploadAndProcess(...keys: string[]) {
  const { uploadDocumentsAction, processDocumentAction } = await docs();
  const fd = new FormData();
  for (const k of keys) fd.append("files", new File([`%PDF-1.4\n% SYNTHETIC KEY:${k} ${Math.random()}\n`.replace(/ 0\.\d+/, k.endsWith("-dup") ? "" : "")], `${k}.pdf`, { type: "application/pdf" }));
  const up = await uploadDocumentsAction(undefined, fd);
  if (!up.ok) throw new Error(up.error);
  const out: Array<{ id: string; key: string; duplicateOf: string | null; result: Awaited<ReturnType<typeof processDocumentAction>> | null }> = [];
  for (const [i, d] of up.documents.entries()) {
    const result = d.duplicateOf ? null : await processDocumentAction(d.id);
    out.push({ id: d.id, key: keys[i], duplicateOf: d.duplicateOf, result });
  }
  return out;
}

async function newLoad(n: string, driver: string | null, total: number, extra: Record<string, unknown> = {}) {
  const v = { pickup_date: "2026-10-13", delivery_date: "2026-10-14", origin: "Dallas, TX", destination: "Houston, TX", miles: 240, status: "pending", ...extra };
  const r = await one<{ id: string }>(`insert into public.loads (profile_id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, destination,
      total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status)
    values ($1, $2, $3, 'Blue Ridge Logistics', '500100', $4, $5, $6, $7, $8, 0, $9, 0, 0, $9, $10) returning id`,
    [C.id, driver, n, v.pickup_date, v.delivery_date, v.origin, v.destination, v.miles, total, v.status]);
  return r.id;
}

const settlementsForLoad = (loadId: string) => q<{ settlement_id: string; status: string; net_pay: string }>(
  `select sl.settlement_id, s.status, s.net_pay::text from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id where sl.load_id = $1 and sl.is_adjustment = false`, [loadId]);
async function statement(settlementId: string) {
  const supa = pgSupabase(pool!, C, H.__ap.storage) as never;
  const b = (await loadBundle(supa, settlementId))!.bundle;
  const r = displayCalculation(b);
  return { b, r, net: r.netDriverPay.toFixed2(), earnings: r.driverBaseEarnings.toFixed2(), deductions: r.totalDriverDeductions.toFixed2() };
}
const docRow = async (id: string) => (await q<Record<string, unknown>>("select * from public.documents where id = $1", [id]))[0];

describe.skipIf(!ENABLED)("automatic upload -> paystub (real Postgres, RLS, real server actions)", () => {
  beforeAll(async () => {
    const req = createRequire(process.env.SPU_E2E_PG_MODULE!);
    const { Pool } = req("pg") as { Pool: new (o: Record<string, unknown>) => PgPoolLike & { end(): Promise<void> } };
    pool = new Pool({ host: process.env.SPU_E2E_PGHOST, port: Number(process.env.SPU_E2E_PGPORT), user: "postgres", database: "postgres", max: 30 });
    H.__ap.pool = pool;
    H.__ap.fn = fakeExtractor;
    process.env.SMART_PAYROLL_CONFIRM = "local-only";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.DOCUMENT_EXTRACTION_VERSION = "v3";
    delete process.env.SMART_PAYROLL_AUTO;
  });
  afterAll(async () => { await pool?.end(); });

  let L1001 = "";
  let rc1001 = "";
  let S1 = "";

  it("1. rate con for an existing load -> classified, extracted, matched, filed, DRAFT paystub with the engine's cents", async () => {
    as(C);
    L1001 = await newLoad("SPA-1001", MARCUS, 1850);
    const [r] = await uploadAndProcess("rc-1001");
    rc1001 = r.id;
    expect(r.result).toMatchObject({ ok: true, state: "auto_routed" });
    const payroll = (r.result as { payroll?: { state: string; settlementId?: string } }).payroll;
    expect(payroll, JSON.stringify(payroll)).toMatchObject({ state: "drafted" });
    const d = await docRow(rc1001);
    expect(d).toMatchObject({ extraction_version: "v3", load_id: L1001, review_status: "approved", payroll_status: "confirmed" });
    expect((d.routing as { autopay: { state: string } }).autopay.state).toBe("drafted");
    const lines = await settlementsForLoad(L1001);
    expect(lines).toHaveLength(1);
    S1 = lines[0].settlement_id;
    expect(d.settlement_id).toBe(S1);
    expect(lines[0].status).toBe("draft"); // never approved or paid automatically
    const st = await statement(S1);
    expect(st.earnings).toBe("1295.00"); // 70 % of the STORED $1,850.00
    expect(st.net).toBe("1295.00");
    expect(lines[0].net_pay).toBe("1295.00");
    expect(st.b.header.periodStart).toBe("2026-10-12");
    expect(st.b.header.periodEnd).toBe("2026-10-18");
    const [claim] = await q<{ status: string; confirmation: { mode: string } }>("select status, confirmation from public.document_payroll_claims where document_id = $1", [rc1001]);
    expect(claim.status).toBe("confirmed");
    expect(claim.confirmation.mode).toBe("automatic");
    const audit = await q<{ action: string }>("select action from public.settlement_audit_events where settlement_id = $1 order by timestamp", [S1]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["created", "load_added"]));
  });

  it("2. BOL + POD for the same load (one multi-file upload) -> attached to the load, no second pay line", async () => {
    as(C);
    const rows = await uploadAndProcess("bol-1001", "pod-1001");
    for (const r of rows) {
      expect(r.result).toMatchObject({ ok: true, state: "auto_routed" });
      expect((await docRow(r.id)).load_id).toBe(L1001);
    }
    expect(await settlementsForLoad(L1001)).toHaveLength(1);
    expect((await statement(S1)).net).toBe("1295.00");
  });

  it("3. lumper + fuel receipts (company driver) -> categorised expenses on the load, company cost, pay unchanged", async () => {
    as(C);
    await uploadAndProcess("lumper-1001", "fuel-1001");
    const ex = await q<{ category: string; amount: string; load_id: string }>("select category, amount::text, load_id from public.expenses where load_id = $1 order by category", [L1001]);
    expect(ex).toEqual([{ category: "fuel", amount: "412.18", load_id: L1001 }, { category: "lumper", amount: "150.00", load_id: L1001 }]);
    expect((await statement(S1)).deductions).toBe("0.00");
    expect((await statement(S1)).net).toBe("1295.00");
  });

  it("4. duplicate uploads never create a second payment", async () => {
    as(C);
    const { uploadDocumentsAction, processDocumentAction, runAutoPayrollAction } = await docs();
    // the exact same file again
    const fd = new FormData();
    const orig = [...H.__ap.storage.objects.entries()].find(([p]) => p.includes(rc1001))![1].text!;
    fd.append("files", new File([orig], "rc-1001-again.pdf", { type: "application/pdf" }));
    const up = await uploadDocumentsAction(undefined, fd);
    expect(up.ok && up.documents[0].duplicateOf).toBe(rc1001);
    const dupId = up.ok ? up.documents[0].id : "";
    expect((await processDocumentAction(dupId)) as unknown).toMatchObject({ ok: true, state: "skipped" });
    expect(await runAutoPayrollAction(dupId)).toMatchObject({ ok: true, message: "Nothing to do for payroll." });
    // a different scan of the same rate con: filed to the load, payroll HELD
    const [rescan] = await uploadAndProcess("rc-1001-rescan");
    expect(rescan.result).toMatchObject({ ok: true, state: "auto_routed" });
    expect((rescan.result as { payroll?: { state: string } }).payroll?.state).toBe("held");
    expect(await settlementsForLoad(L1001)).toHaveLength(1);
    expect((await statement(S1)).net).toBe("1295.00");
  });

  let L2002 = "";
  let S2 = "";
  it("5. out of order: POD + receipts BEFORE the rate con; new load created from the rate con -> everything joins ONE draft", async () => {
    as(C);
    const early = await uploadAndProcess("pod-2002", "fuel-2002", "toll-2002", "scale-2002");
    for (const r of early) expect(r.result).toMatchObject({ ok: true, state: "needs_review" }); // no load yet
    const [rc] = await uploadAndProcess("rc-2002");
    expect(rc.result).toMatchObject({ ok: true, state: "needs_review" });
    const d = await docRow(rc.id);
    expect((d.routing as { proposed: { kind: string } }).proposed.kind).toBe("create_load"); // never automatic

    // The owner presses "Create load" (values pre-filled from the document; driver pre-selected from the printed name).
    const { createLoadFromDocumentAction } = await docs();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ load_number: "SPA-2002", broker_name: "Blue Ridge Logistics", broker_mc_number: "500100", origin: "Tulsa, OK", destination: "Denver, CO",
      pickup_date: "2026-10-14", delivery_date: "2026-10-15", total_miles: "680", line_haul_rate: "2400", fuel_surcharge: "0", accessorial_charges: "0", total_revenue: "2400", driver_id: TINA })) fd.append(k, v);
    const created = await createLoadFromDocumentAction(rc.id, undefined, fd);
    if (created && created.ok === false) throw new Error(`create load: ${created.message}`);
    const [load] = await q<{ id: string; driver_id: string }>("select id, driver_id from public.loads where load_number = 'SPA-2002' and profile_id = $1", [C.id]);
    L2002 = load.id;
    expect(load.driver_id).toBe(TINA);
    for (const r of early) expect((await docRow(r.id)).review_status).toBe("auto_routed"); // waiting paperwork filed
    const lines = await settlementsForLoad(L2002);
    expect(lines).toHaveLength(1);
    S2 = lines[0].settlement_id;
    const st = await statement(S2);
    expect(st.earnings).toBe("2112.00"); // 88 % of $2,400.00
    expect(st.b.deductions.map((x) => [x.category, Number(x.amount).toFixed(2), x.responsibility, !!x.relatedExpenseId, !!x.documentId]).sort()).toEqual([
      ["fuel", "412.18", "driver", true, true], ["scale_tickets", "13.50", "driver", true, true], ["tolls", "18.25", "driver", true, true],
    ]);
    expect(st.deductions).toBe("443.93");
    expect(st.net).toBe("1668.07");
    // re-running everything is a no-op (idempotent)
    const { runAutoPayrollAction } = await docs();
    for (const r of [...early, rc]) await runAutoPayrollAction(r.id);
    expect((await statement(S2)).net).toBe("1668.07");
    expect((await statement(S2)).b.deductions).toHaveLength(3);
  });

  it("6. ambiguous / unverifiable paperwork is held, never paid", async () => {
    as(C);
    // rate on the paperwork disagrees with the load record -> stays in review, no settlement
    const L3003 = await newLoad("SPA-3003", MARCUS, 1850);
    const [wrong] = await uploadAndProcess("rc-3003-wrong-rate");
    expect(wrong.result).toMatchObject({ ok: true, state: "needs_review" });
    expect(((await docRow(wrong.id)).routing as { reasons: string[] }).reasons).toContain("rate_mismatch");
    expect(await settlementsForLoad(L3003)).toHaveLength(0);
    // driver with no pay rule -> filed but payroll HELD with the reason; fixing the rule + "Try again" drafts it
    const L4004 = await newLoad("SPA-4004", SAM, 1000);
    const [r] = await uploadAndProcess("rc-4004");
    expect((r.result as { payroll?: { state: string; holds: { code: string }[] } }).payroll).toMatchObject({ state: "held", holds: [{ code: "no_pay_agreement" }] });
    expect(await settlementsForLoad(L4004)).toHaveLength(0);
    await exec("update public.drivers set pay_percentage = 75 where id = $1", [SAM]);
    const { runAutoPayrollAction } = await docs();
    expect(await runAutoPayrollAction(r.id)).toMatchObject({ ok: true });
    const lines = await settlementsForLoad(L4004);
    expect(lines).toHaveLength(1);
    expect((await statement(lines[0].settlement_id)).net).toBe("750.00");
    // a load with no driver assigned -> held
    const L6006 = await newLoad("SPA-6006", null, 1200);
    const [nd] = await uploadAndProcess("rc-6006");
    expect((nd.result as { payroll?: { state: string; holds: { code: string }[] } }).payroll?.state).toBe("held");
    expect((nd.result as { payroll?: { holds: { code: string }[] } }).payroll?.holds.map((h) => h.code)).toContain("load_has_no_driver");
    expect(await settlementsForLoad(L6006)).toHaveLength(0);
  });

  it("7. interruptions recover safely: failed read, read-but-not-filed, filed-but-payroll-never-ran, two runners at once", async () => {
    as(C);
    const { processDocumentAction, retryDocumentAction, runAutoPayrollAction } = await docs();
    // (a) the AI call fails once -> failed; Retry succeeds and drafts once
    const L5005 = await newLoad("SPA-5005", MARCUS, 900);
    FLAKY.add("rc-5005");
    const [f] = await uploadAndProcess("rc-5005");
    expect(f.result).toMatchObject({ ok: true, state: "failed" });
    expect(await settlementsForLoad(L5005)).toHaveLength(0);
    const retried = await retryDocumentAction(f.id);
    expect(retried, JSON.stringify(retried)).toMatchObject({ ok: true });
    const l5 = await settlementsForLoad(L5005);
    expect(l5).toHaveLength(1);
    expect(l5[0].settlement_id).toBe(S1); // same driver, same week -> joins Marcus's open draft
    expect((await statement(S1)).net).toBe("1925.00"); // 70 % of (1850 + 900)

    // (b) crashed after extraction, before filing -> the resume pass files and drafts it
    const L7007 = await newLoad("SPA-7007", MARCUS, 1300, { pickup_date: "2026-10-20", delivery_date: "2026-10-21" });
    const { uploadDocumentsAction } = await docs();
    const fd = new FormData();
    fd.append("files", new File(["%PDF-1.4\n% SYNTHETIC KEY:rc-7007\n"], "rc-7007.pdf", { type: "application/pdf" }));
    const up = await uploadDocumentsAction(undefined, fd);
    const id7 = up.ok ? up.documents[0].id : "";
    await fakeExtractor("extract-document", { document_id: id7, extraction_version: "v3" }, C.id); // ...then the request died
    expect((await docRow(id7)).review_status).toBeNull();
    const res7 = await processDocumentAction(id7); // what ResumeProcessing runs on the next page load
    expect(await settlementsForLoad(L7007), JSON.stringify(res7)).toHaveLength(1);

    // (c) filed while payroll was switched off (deploy / crash) -> found by the resume scan, drafted once
    const L8008 = await newLoad("SPA-8008", MARCUS, 1400, { pickup_date: "2026-10-20", delivery_date: "2026-10-22" });
    process.env.SMART_PAYROLL_AUTO = "off";
    const [c8] = await uploadAndProcess("rc-8008");
    delete process.env.SMART_PAYROLL_AUTO;
    expect(await settlementsForLoad(L8008)).toHaveLength(0);
    const docsNow = await q<Record<string, unknown>>("select * from public.documents where profile_id = $1", [C.id]);
    const later = Date.parse(String((await docRow(c8.id)).updated_at ?? "")) + 5 * 60_000;
    expect(payrollResumeCandidates(docsNow as never, Math.max(later, Date.now() + 5 * 60_000))).toContain(c8.id);
    // (d) two runners at the same moment (two tabs) -> exactly one draft line
    const [a, b] = await Promise.all([runAutoPayrollAction(c8.id), runAutoPayrollAction(c8.id)]);
    expect([a?.ok, b?.ok]).toContain(true);
    expect(await settlementsForLoad(L8008)).toHaveLength(1);
    // L7007 and L8008 are the same driver and week -> one draft, two loads
    const s7 = (await settlementsForLoad(L7007))[0].settlement_id;
    expect((await settlementsForLoad(L8008))[0].settlement_id).toBe(s7);
    expect((await statement(s7)).net).toBe("1890.00"); // 70 % of (1300 + 1400)
  });

  it("8. another carrier can't read, process, or draft from these documents or see the payroll", async () => {
    as(E);
    const { processDocumentAction, runAutoPayrollAction } = await docs();
    expect(await processDocumentAction(rc1001)).toMatchObject({ ok: true, state: "skipped" });
    expect(await runAutoPayrollAction(rc1001)).toMatchObject({ ok: true, message: "Nothing to do for payroll." });
    const supa = pgSupabase(pool!, E, H.__ap.storage);
    const { data: ds } = await supa.from("documents").select("id").eq("id", rc1001);
    const { data: ss } = await supa.from("settlements").select("id").eq("id", S1);
    const { data: ex } = await supa.from("expenses").select("id").eq("load_id", L1001);
    expect([ds, ss, ex]).toEqual([[], [], []]);
    as(C);
    expect((await statement(S1)).net).toBe("1925.00");
  });

  it("9. an APPROVED settlement is never changed by later uploads; undo is refused", async () => {
    as(C);
    const { transitionSettlementAction } = await settlements();
    const before = (await loadBundle(pgSupabase(pool!, C, H.__ap.storage) as never, S1))!.bundle.header;
    expect(await transitionSettlementAction(S1, { target: "approved", expectedUpdatedAt: before.updatedAt })).toMatchObject({ ok: true });
    const approved = (await loadBundle(pgSupabase(pool!, C, H.__ap.storage) as never, S1))!.bundle.header;
    const [late] = await uploadAndProcess("toll-1001-late");
    expect(late.result).toMatchObject({ ok: true }); // load is settled -> receipt waits in review
    expect(((await docRow(late.id)).routing as { reasons?: string[] }).reasons ?? []).toContain("load_protected");
    const after = (await loadBundle(pgSupabase(pool!, C, H.__ap.storage) as never, S1))!.bundle.header;
    expect(after.updatedAt).toBe(approved.updatedAt);
    expect(after.status).toBe("approved");
    expect((await statement(S1)).net).toBe("1925.00");
    const { undoDocumentAction, runAutoPayrollAction } = await docs();
    expect(await undoDocumentAction(rc1001, 0)).toMatchObject({ ok: false });
    expect(await runAutoPayrollAction(rc1001)).toMatchObject({ ok: true, message: "Nothing to do for payroll." });
    // nothing anywhere was marked paid
    expect(await q("select id from public.settlements where status = 'paid' and profile_id = $1", [C.id])).toEqual([]);
  });

  it("10. with the confirmation gate off, documents still file but no payroll is written", async () => {
    as(C);
    const saved = process.env.SMART_PAYROLL_CONFIRM;
    delete process.env.SMART_PAYROLL_CONFIRM;
    const L9 = await newLoad("SPA-9009", MARCUS, 1000, { pickup_date: "2026-10-06", delivery_date: "2026-10-07" });
    MODEL.set("rc-9009", RC("SPA-9009", 1000, { pickup_date: "2026-10-06", delivery_date: "2026-10-07" }));
    const [r] = await uploadAndProcess("rc-9009");
    process.env.SMART_PAYROLL_CONFIRM = saved;
    expect(r.result).toMatchObject({ ok: true, state: "auto_routed" });
    expect((r.result as { payroll?: unknown }).payroll).toBeUndefined();
    expect(await settlementsForLoad(L9)).toHaveLength(0);
  });
});
