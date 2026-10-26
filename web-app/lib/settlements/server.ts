// =============================================================================
//  Settlement data access (server only)
// -----------------------------------------------------------------------------
//  RLS (profile_id = auth.uid()) scopes every query; nothing here filters by
//  account on trust. Writes follow the iPhone order — header → child upserts →
//  prune rows no longer on the settlement — with one addition: the header
//  update is guarded by the `updated_at` the editor loaded, so an edit made on
//  the iPhone (or another tab) in the meantime is never silently overwritten.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { D } from "@/lib/money/money";
import {
  ADDITION_CATEGORY_LABEL, DEDUCTION_CATEGORY_LABEL, normaliseResponsibility,
  type CustomCategory, type SettlementBundle,
} from "./model";
import {
  additionFromRow, additionToRow, deductionFromRow, deductionToRow, headerFromRow, lineFromRow,
  lineToRow, recurringFromRow, SETTLEMENT_COLUMNS, n2s,
} from "./rows";
import type { AuditEvent, HeaderTotals } from "./workflow";

type Row = Record<string, unknown>;

export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205"
    || msg.includes("schema cache") || msg.includes("does not exist");
}

export async function loadBundle(supabase: SupabaseClient, id: string): Promise<{ bundle: SettlementBundle; raw: Row } | null> {
  const { data: h, error } = await supabase.from("settlements").select(SETTLEMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!h) return null;
  const [lines, adds, deds] = await Promise.all([
    supabase.from("settlement_loads").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("settlement_additions").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("settlement_deductions").select("*").eq("settlement_id", id).order("sort_order"),
  ]);
  for (const r of [lines, adds, deds]) if (r.error) throw new Error(r.error.message);
  return {
    raw: h as unknown as Row,
    bundle: {
      header: headerFromRow(h as unknown as Row),
      loadLines: ((lines.data ?? []) as Row[]).map(lineFromRow),
      additions: ((adds.data ?? []) as Row[]).map(additionFromRow),
      deductions: ((deds.data ?? []) as Row[]).map(deductionFromRow),
    },
  };
}

/** True once 20261024011809_payroll_custom_categories.sql is applied. */
export async function customCategoriesAvailable(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("payroll_custom_categories").select("id").limit(1);
  return !error;
}

export async function listCustomCategories(supabase: SupabaseClient): Promise<{ available: boolean; categories: CustomCategory[] }> {
  const { data, error } = await supabase
    .from("payroll_custom_categories")
    .select("id, kind, name, base_category, default_responsibility, default_driver_share_percent, is_archived")
    .order("name");
  if (error) return { available: false, categories: [] };
  return {
    available: true,
    categories: ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      kind: r.kind === "addition" ? "addition" : "deduction",
      name: String(r.name ?? ""),
      baseCategory: String(r.base_category ?? "other"),
      defaultResponsibility: normaliseResponsibility(r.default_responsibility),
      defaultDriverSharePercent: n2s(r.default_driver_share_percent, "100"),
      isArchived: r.is_archived === true,
    })),
  };
}

/**
 * Before the migration is applied: the carrier's own past "Other" line
 * descriptions double as reusable custom categories (no new storage needed).
 */
export async function recentOtherDescriptions(supabase: SupabaseClient): Promise<{ addition: string[]; deduction: string[] }> {
  const [a, d] = await Promise.all([
    supabase.from("settlement_additions").select("description").eq("category", "other").order("created_at", { ascending: false }).limit(200),
    supabase.from("settlement_deductions").select("description").eq("category", "other").order("created_at", { ascending: false }).limit(200),
  ]);
  const uniq = (rows: Row[] | null) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows ?? []) {
      const v = String(r.description ?? "").trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k) || v === ADDITION_CATEGORY_LABEL.other || v === DEDUCTION_CATEGORY_LABEL.other) continue;
      seen.add(k);
      out.push(v);
    }
    return out.slice(0, 40);
  };
  return { addition: uniq(a.data as Row[] | null), deduction: uniq(d.data as Row[] | null) };
}

export interface LedgerFacts {
  /** load id → number/label of the APPROVED/PAID settlement that pays it. */
  alreadyPaid: Map<string, string>;
  otherNumbers: string[];
  allNumbers: string[];
}

export async function ledgerFacts(supabase: SupabaseClient, excludingSettlementId: string | null): Promise<LedgerFacts> {
  const { data: sRaw, error } = await supabase
    .from("settlements")
    .select("id, settlement_number, status, is_estimate");
  if (error) throw new Error(error.message);
  const rows = (sRaw ?? []) as Row[];
  const paying = new Map<string, string>();
  const otherNumbers: string[] = [];
  const allNumbers: string[] = [];
  for (const r of rows) {
    const id = String(r.id);
    const num = typeof r.settlement_number === "string" ? r.settlement_number : null;
    if (num) allNumbers.push(num);
    if (id !== excludingSettlementId && num) otherNumbers.push(num);
    const st = String(r.status ?? "");
    if (id !== excludingSettlementId && r.is_estimate !== true && (st === "approved" || st === "paid")) {
      paying.set(id, num ?? `settlement #${id.slice(0, 8)}`);
    }
  }
  const alreadyPaid = new Map<string, string>();
  const ids = [...paying.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const { data: lRaw, error: lErr } = await supabase
      .from("settlement_loads")
      .select("load_id, settlement_id, is_adjustment")
      .in("settlement_id", chunk)
      .eq("is_adjustment", false)
      .not("load_id", "is", null);
    if (lErr) throw new Error(lErr.message);
    for (const l of (lRaw ?? []) as Row[]) {
      alreadyPaid.set(String(l.load_id), paying.get(String(l.settlement_id)) ?? "another settlement");
    }
  }
  return { alreadyPaid, otherNumbers, allNumbers };
}

export async function recurringRulesFor(supabase: SupabaseClient, driverId: string | null) {
  if (!driverId) return [];
  const { data, error } = await supabase.from("recurring_deductions").select("*").eq("driver_id", driverId);
  if (error) return [];
  return ((data ?? []) as Row[]).map(recurringFromRow);
}

/** iOS ledger.lastAppliedRecurringDates(): rule id → latest period start on an approved/paid settlement. */
export async function lastAppliedRecurring(supabase: SupabaseClient, ruleIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ruleIds.length === 0) return out;
  const { data: dRaw } = await supabase
    .from("settlement_deductions")
    .select("recurring_deduction_id, settlement_id")
    .in("recurring_deduction_id", ruleIds);
  const dRows = (dRaw ?? []) as Row[];
  const sids = [...new Set(dRows.map((r) => String(r.settlement_id)))];
  if (sids.length === 0) return out;
  const { data: sRaw } = await supabase
    .from("settlements")
    .select("id, status, is_estimate, settlement_period_start")
    .in("id", sids);
  const starts = new Map<string, string>();
  for (const s of (sRaw ?? []) as Row[]) {
    const st = String(s.status ?? "");
    if (s.is_estimate === true || !(st === "approved" || st === "paid")) continue;
    const ps = typeof s.settlement_period_start === "string" ? s.settlement_period_start.slice(0, 10) : null;
    if (ps) starts.set(String(s.id), ps);
  }
  for (const d of dRows) {
    const start = starts.get(String(d.settlement_id));
    const rid = String(d.recurring_deduction_id);
    if (!start) continue;
    const cur = out.get(rid);
    if (!cur || start > cur) out.set(rid, start);
  }
  return out;
}

// =============================================================================
//  Atomic writes — every settlement write goes through ONE database
//  transaction (20261024012624_web_settlement_atomic_writes.sql). There is no
//  multi-request fallback: if the functions are missing, nothing is written.
// =============================================================================

/** Carrier-facing error from the atomic functions; `code` is the sph:<code> hint. */
export class SettlementWriteError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
/** Back-compat alias used by callers that only care about conflicts. */
export class ConflictError extends SettlementWriteError {}

export const RPC_MISSING =
  "Saving settlements needs the web settlements database update, which hasn't been applied yet. Nothing was saved.";

function rpcError(error: { code?: string; message?: string; hint?: string | null }): SettlementWriteError {
  const code = (error.hint ?? "").startsWith("sph:") ? (error.hint as string).slice(4) : (error.code ?? "db_error");
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01" || error.code === "42703") {
    return new SettlementWriteError(RPC_MISSING, "rpc_missing");
  }
  if (error.code === "23505") {
    return new SettlementWriteError("That settlement number is already used on another settlement. Nothing was saved.", "duplicate_number");
  }
  const msg = error.message ?? "Database error.";
  return code === "conflict" ? new ConflictError(msg, code) : new SettlementWriteError(msg, code);
}

export interface AuditInput { action: string; summary: string; field_name: string | null; previous_value: string | null; new_value: string | null }

export interface SaveArgs {
  mode: "create" | "update";
  bundle: SettlementBundle;
  headerRow: Row;
  /** updated_at the editor loaded; required for update. */
  expectedUpdatedAt: string | null;
  audit: AuditInput[];
  actorName: string | null;
}

/** Builds the JSON the save function receives (exported for tests). */
export function savePayload(a: SaveArgs): Record<string, unknown> {
  const sid = a.bundle.header.id;
  const pid = a.bundle.header.profileId;
  return {
    mode: a.mode,
    settlement_id: sid,
    expected_updated_at: a.expectedUpdatedAt,
    header: a.headerRow,
    loads: a.bundle.loadLines.map((l) => lineToRow(l, sid, pid)),
    additions: a.bundle.additions.map((x) => additionToRow(x, sid, pid, true)),
    deductions: a.bundle.deductions.map((x) => deductionToRow(x, sid, pid, true)),
    audit: a.audit.map((e) => ({ ...e, actor_name: a.actorName })),
  };
}

export async function saveSettlementAtomic(supabase: SupabaseClient, a: SaveArgs): Promise<{ updatedAt: string | null }> {
  const { data, error } = await supabase.rpc("sph_web_save_settlement", { p: savePayload(a) });
  if (error) throw rpcError(error);
  return { updatedAt: (data as { updated_at?: string } | null)?.updated_at ?? null };
}

export interface TransitionArgs {
  settlementId: string;
  expectedUpdatedAt: string | null;
  from: string;
  to: string;
  reason: string | null;
  settlementNumber: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  audit: AuditInput[];
  actorName: string | null;
  /** Stale-total refresh (a full save), run INSIDE the same transaction. */
  refresh?: SaveArgs;
}

export async function transitionSettlementAtomic(supabase: SupabaseClient, a: TransitionArgs): Promise<{ updatedAt: string | null }> {
  const { data, error } = await supabase.rpc("sph_web_transition_settlement", {
    p: {
      settlement_id: a.settlementId,
      expected_updated_at: a.expectedUpdatedAt,
      from: a.from,
      to: a.to,
      reason: a.reason,
      settlement_number: a.settlementNumber,
      payment_method: a.paymentMethod,
      payment_reference: a.paymentReference,
      audit: a.audit.map((e) => ({ ...e, actor_name: a.actorName })),
      ...(a.refresh ? { refresh: savePayload(a.refresh) } : {}),
    },
  });
  if (error) throw rpcError(error);
  return { updatedAt: (data as { updated_at?: string } | null)?.updated_at ?? null };
}

export type { HeaderTotals };

/**
 * iPhone parity for two approval blockers:
 *   • advance_over_recovery — what this settlement recovers from an advance may
 *     not exceed what is still owed (repayments on OTHER settlements excluded).
 *   • expense_already_linked — one company expense deducted on two live
 *     (non-voided, non-estimate) settlements is double accounting.
 */
export async function advanceFacts(
  supabase: SupabaseClient, settlementId: string, b: SettlementBundle,
): Promise<{ advanceOutstanding: Map<string, string>; linkedExpenses: Map<string, string> }> {
  const advanceOutstanding = new Map<string, string>();
  const linkedExpenses = new Map<string, string>();
  const advIds = [...new Set(b.deductions.map((d) => d.advanceId).filter((x): x is string => !!x))];
  if (advIds.length > 0) {
    const [{ data: adv }, { data: reps }] = await Promise.all([
      supabase.from("driver_advances").select("id, amount").in("id", advIds),
      supabase.from("driver_advance_repayments").select("advance_id, amount, settlement_id").in("advance_id", advIds),
    ]);
    for (const a of (adv ?? []) as Row[]) {
      const id = String(a.id);
      let owed = new D(n2s(a.amount));
      for (const r of (reps ?? []) as Row[]) {
        if (String(r.advance_id) === id && String(r.settlement_id ?? "") !== settlementId) owed = owed.minus(n2s(r.amount));
      }
      advanceOutstanding.set(id, D.max(0, owed).toFixed(2));
    }
  }
  const expIds = [...new Set(b.deductions.map((d) => d.relatedExpenseId).filter((x): x is string => !!x))];
  if (expIds.length > 0) {
    const { data: deds } = await supabase.from("settlement_deductions").select("related_expense_id, settlement_id").in("related_expense_id", expIds).neq("settlement_id", settlementId);
    const sids = [...new Set(((deds ?? []) as Row[]).map((d) => String(d.settlement_id)))];
    if (sids.length > 0) {
      const { data: ss } = await supabase.from("settlements").select("id, status, is_estimate, settlement_number").in("id", sids);
      const live = new Map<string, string>();
      for (const s of (ss ?? []) as Row[]) {
        if (s.is_estimate === true || String(s.status ?? "") === "voided") continue;
        live.set(String(s.id), typeof s.settlement_number === "string" ? s.settlement_number : "another settlement");
      }
      for (const d of (deds ?? []) as Row[]) {
        const n = live.get(String(d.settlement_id));
        if (n) linkedExpenses.set(String(d.related_expense_id), n);
      }
    }
  }
  return { advanceOutstanding, linkedExpenses };
}
