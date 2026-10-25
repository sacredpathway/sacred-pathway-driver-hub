// =============================================================================
//  Automatic payroll — wiring to Supabase (server only)
// -----------------------------------------------------------------------------
//  Every read uses the signed-in carrier's client (RLS: profile_id =
//  auth.uid()) AND filters by the owner id. Every write goes through an
//  existing, tested path (confirmPayrollDraft / settlement core).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveExtraction } from "../documents/routing";
import { buildPayrollProposal } from "../payrollUpload/proposal";
import { confirmPayrollDraft } from "../payrollUpload/confirm";
import { makeConfirmDeps, type SettlementActions } from "../payrollUpload/wire";
import { bundleToEditPayload, getCarrierProfile, getProposalDocument, readProposalInput } from "../payrollUpload/server";
import { payrollConfirmGate, GATE_MESSAGE } from "../payrollUpload/featureFlag";
import { loadBundle } from "../settlements/server";
import { isWebEditLocked, normaliseStatus, type Deduction } from "../settlements/model";
import { paySettingsForDriver, legacyPayOnGross } from "../settlements/workflow";
import type { CoreCtx } from "../settlements/core";
import type { AutoDeps, AutoOutcome } from "./run";
import type { ExpenseRow } from "./plan";

type Row = Record<string, unknown>;
const EXPENSE_COLUMNS = "id, load_id, category, amount, receipt_date, vendor_name, source_document_id";
const OPEN = new Set(["draft", "ready_for_review"]);

/** Automation runs only where confirmation is enabled, unless explicitly switched off. */
export function autoGate(env: Readonly<Record<string, string | undefined>>): { enabled: boolean; reason: string } {
  const g = payrollConfirmGate(env);
  if (!g.enabled) return { enabled: false, reason: GATE_MESSAGE[g.reason] };
  if ((env.SMART_PAYROLL_AUTO ?? "").trim().toLowerCase() === "off") {
    return { enabled: false, reason: "Automatic payroll drafts are switched off. Documents still file automatically; drafts are made from the payroll review." };
  }
  return { enabled: true, reason: GATE_MESSAGE[g.reason] };
}

export interface AutoWireOptions {
  today: string;
  actions: SettlementActions;
  saveCore(c: CoreCtx, id: string, expectedUpdatedAt: string | null, payload: ReturnType<typeof bundleToEditPayload>, opts: { serverDeductions?: Deduction[] }): Promise<{ ok: true } | { ok: false; error: string }>;
  user: { id: string; email: string | null };
  env?: Readonly<Record<string, string | undefined>>;
}

export function makeAutoDeps(supabase: SupabaseClient, o: AutoWireOptions): AutoDeps {
  const ownerId = o.user.id;
  const env = o.env ?? process.env;
  const gate = autoGate(env);
  const ctx: CoreCtx = { supabase: supabase as never, user: { id: ownerId, email: o.user.email }, actor: { userId: ownerId, name: o.user.email } };

  const settlementsById = async (ids: string[]) => {
    if (!ids.length) return new Map<string, Row>();
    const { data, error } = await supabase.from("settlements")
      .select("id, profile_id, status, updated_at, driver_id, is_estimate").in("id", ids).eq("profile_id", ownerId);
    if (error) throw new Error(error.message);
    return new Map(((data ?? []) as Row[]).map((r) => [String(r.id), r]));
  };

  return {
    enabled: gate.enabled,
    disabledReason: gate.reason,

    async getDocument(id) {
      const { data, error } = await supabase.from("documents")
        .select("id, profile_id, load_id, settlement_id, review_status, routing, extracted_data")
        .eq("id", id).eq("profile_id", ownerId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const r = data as Row;
      const routing = (r.routing ?? null) as { type?: unknown; corrections?: Record<string, unknown> } | null;
      const routedType = typeof routing?.type === "string"
        ? routing.type
        : effectiveExtraction(r.extracted_data, routing?.corrections ?? null).extraction.document_type;
      return {
        id: String(r.id), profile_id: String(r.profile_id), load_id: (r.load_id as string | null) ?? null,
        settlement_id: (r.settlement_id as string | null) ?? null, review_status: (r.review_status as string | null) ?? null,
        routedType,
      };
    },

    async proposal(documentId, decisions) {
      const profile = await getCarrierProfile(supabase, ownerId);
      if (!profile) throw new Error("profile_not_found");
      const doc = await getProposalDocument(supabase, ownerId, documentId);
      if (!doc) throw new Error("document_not_found");
      return buildPayrollProposal(await readProposalInput(supabase, doc, profile, decisions, o.today));
    },

    async driverPay(driverId) {
      const [{ data: d, error }, { data: p }] = await Promise.all([
        supabase.from("drivers")
          .select("id, profile_id, pay_percentage, pay_type, flat_rate, pay_rule, settlement_type, pay_on_gross_revenue, lease_config, truck_number")
          .eq("id", driverId).eq("profile_id", ownerId).maybeSingle(),
        supabase.from("profiles").select("pay_basis").eq("id", ownerId).maybeSingle(),
      ]);
      if (error || !d) return null;
      return paySettingsForDriver(d as never, legacyPayOnGross((p ?? null) as never));
    },

    async driverPeriod(driverId) {
      const [{ data: d }, { data: ss }] = await Promise.all([
        supabase.from("drivers").select("pay_frequency").eq("id", driverId).eq("profile_id", ownerId).maybeSingle(),
        supabase.from("settlements").select("settlement_period_start, settlement_period_end, status, is_estimate")
          .eq("driver_id", driverId).eq("profile_id", ownerId).order("settlement_period_end", { ascending: false }).limit(20),
      ]);
      return {
        frequency: ((d as Row | null)?.pay_frequency as string | null) ?? null,
        recent: ((ss ?? []) as Row[])
          .filter((r) => r.status !== "voided" && r.is_estimate !== true && r.settlement_period_start && r.settlement_period_end)
          .map((r) => ({ start: String(r.settlement_period_start).slice(0, 10), end: String(r.settlement_period_end).slice(0, 10) })),
      };
    },

    async isEarliestUnlinkedCopy(documentId, sameIdentityIds) {
      const ids = [documentId, ...sameIdentityIds.filter((x) => x !== documentId)].slice(0, 50);
      const { data, error } = await supabase.from("documents").select("id, created_at, settlement_id, review_status, duplicate_of")
        .in("id", ids).eq("profile_id", ownerId);
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as Row[]).filter((r) => r.review_status !== "dismissed" && !r.duplicate_of);
      if (rows.some((r) => r.settlement_id)) return false;
      const sorted = rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      return sorted[0]?.id === documentId;
    },

    async loadDriver(loadId) {
      const { data } = await supabase.from("loads").select("driver_id").eq("id", loadId).eq("profile_id", ownerId).maybeSingle();
      return ((data as Row | null)?.driver_id as string | null) ?? null;
    },

    async confirm(documentId, decisions) {
      const deps = makeConfirmDeps(supabase, ownerId, o.today, o.actions, env);
      return confirmPayrollDraft(deps, o.user, documentId, decisions, o.today, { mode: "automatic" });
    },

    async expensesForLoad(loadId) {
      const { data, error } = await supabase.from("expenses").select(EXPENSE_COLUMNS).eq("load_id", loadId).eq("profile_id", ownerId).limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ExpenseRow[];
    },

    async expenseForDocument(documentId) {
      const { data, error } = await supabase.from("expenses").select(EXPENSE_COLUMNS).eq("source_document_id", documentId).eq("profile_id", ownerId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as ExpenseRow | null) ?? null;
    },

    async deductedExpenseIds(expenseIds) {
      const out = new Set<string>();
      if (!expenseIds.length) return out;
      const { data, error } = await supabase.from("settlement_deductions").select("related_expense_id, settlement_id")
        .in("related_expense_id", expenseIds).eq("profile_id", ownerId);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      const sets = await settlementsById([...new Set(rows.map((r) => String(r.settlement_id)))]);
      for (const r of rows) {
        const s = sets.get(String(r.settlement_id));
        if (s && normaliseStatus(s.status as string) !== "voided") out.add(String(r.related_expense_id));
      }
      return out;
    },

    async draftForLoad(loadId) {
      const { data, error } = await supabase.from("settlement_loads").select("settlement_id")
        .eq("load_id", loadId).eq("profile_id", ownerId).eq("is_adjustment", false);
      if (error) throw new Error(error.message);
      const ids = [...new Set(((data ?? []) as Row[]).map((r) => String(r.settlement_id)))];
      const sets = await settlementsById(ids);
      const open = [...sets.values()].filter((s) => s.is_estimate !== true && OPEN.has(String(s.status ?? "draft")));
      if (open.length === 0) return null;
      if (open.length > 1) return "ambiguous";
      const s = open[0];
      const { data: deds, error: dErr } = await supabase.from("settlement_deductions").select("related_expense_id")
        .eq("settlement_id", String(s.id)).eq("profile_id", ownerId);
      if (dErr) throw new Error(dErr.message);
      return {
        settlementId: String(s.id), status: String(s.status), updatedAt: (s.updated_at as string | null) ?? null,
        driverId: (s.driver_id as string | null) ?? null, loadIds: [loadId],
        relatedExpenseIds: ((deds ?? []) as Row[]).map((r) => r.related_expense_id).filter((x): x is string => typeof x === "string"),
      };
    },

    async addDeductions(settlementId, _expectedUpdatedAt, deductions) {
      // Re-read: the version check below is the database's (sph_web_save_settlement).
      const loaded = await loadBundle(supabase, settlementId);
      if (!loaded || loaded.bundle.header.profileId !== ownerId) return { ok: false, error: "Settlement not found." };
      const b = loaded.bundle;
      if (isWebEditLocked(b.header.status)) return { ok: false, error: "That settlement is locked; nothing was added." };
      const have = new Set(b.deductions.map((d) => d.relatedExpenseId).filter(Boolean) as string[]);
      const fresh = deductions.filter((d) => !d.relatedExpenseId || !have.has(d.relatedExpenseId));
      if (!fresh.length) return { ok: true };
      return o.saveCore(ctx, settlementId, b.header.updatedAt, bundleToEditPayload(b), { serverDeductions: fresh });
    },

    async record(documentId, outcome) {
      await recordOutcome(supabase, ownerId, documentId, outcome);
    },
  };
}

export async function recordOutcome(supabase: SupabaseClient, ownerId: string, documentId: string, outcome: AutoOutcome): Promise<void> {
  const { data } = await supabase.from("documents").select("routing").eq("id", documentId).eq("profile_id", ownerId).maybeSingle();
  const routing = ((data as Row | null)?.routing ?? {}) as Row;
  const at = new Date().toISOString();
  const history = Array.isArray(routing.history) ? (routing.history as unknown[]) : [];
  const autopay = {
    state: outcome.state, at,
    holds: outcome.holds.slice(0, 10),
    ...(outcome.settlementId ? { settlement_id: outcome.settlementId } : {}),
    ...(outcome.deductionsAdded ? { deductions_added: outcome.deductionsAdded } : {}),
  };
  const ev = { at, by: "automation", event: `autopay:${outcome.state}`, ...(outcome.holds[0] ? { detail: outcome.holds[0].message.slice(0, 300) } : outcome.settlementId ? { detail: outcome.settlementId } : {}) };
  await supabase.from("documents").update({ routing: { ...routing, autopay, history: [...history, ev].slice(-50) } })
    .eq("id", documentId).eq("profile_id", ownerId);
}

/** Read back the last automatic-payroll outcome stored on a document. */
export function autopayOf(routing: unknown): { state: string; holds: { code: string; message: string }[]; settlement_id?: string; at?: string } | null {
  if (!routing || typeof routing !== "object") return null;
  const a = (routing as { autopay?: unknown }).autopay;
  if (!a || typeof a !== "object") return null;
  const r = a as Row;
  if (typeof r.state !== "string") return null;
  return {
    state: r.state,
    holds: Array.isArray(r.holds) ? (r.holds as Row[]).filter((h) => typeof h?.message === "string").map((h) => ({ code: String(h.code ?? ""), message: String(h.message) })) : [],
    ...(typeof r.settlement_id === "string" ? { settlement_id: r.settlement_id } : {}),
    ...(typeof r.at === "string" ? { at: r.at } : {}),
  };
}
