// =============================================================================
//  Smart Payroll Upload — data access (server only)
// -----------------------------------------------------------------------------
//  Reads use the signed-in user's Supabase client, so RLS (profile_id =
//  auth.uid()) scopes every row; each query ALSO filters by the owner id and
//  the pure proposal drops anything foreign a third time.
//
//  Writes (only reachable through confirmPayrollDraft, which is gated):
//    * addLoadToDraft      -> the existing saveSettlementAction
//    * claim / release / finalize / recover -> the Phase 3 database functions
//      (sph_payroll_claim*, proposed migration). They own the document link.
//  The draft itself is only ever written by the existing settlement actions.
//  If the claim functions are not installed, confirmation FAILS CLOSED.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { looseIdentifierPattern } from "@/lib/documents/repo";
import { normalizeIdentifier } from "@/lib/documents/matching";
import type { DriverCandidate } from "@/lib/documents/types";
import { loadBundle } from "@/lib/settlements/server";
import { lineFromLoad, type LoadRow } from "@/lib/settlements/workflow";
import type { EditPayload } from "@/lib/settlements/payload";
import type { SettlementBundle } from "@/lib/settlements/model";
import { isWebEditLocked } from "@/lib/settlements/model";
import { sanitizePayrollExtraction } from "@/lib/documents/payrollExtraction";
import type { CarrierProfileRow } from "./carrierIdentity";
import { carrierIdentityFromProfile } from "./carrierIdentity";
import { documentIdentity, type ExistingDocument } from "./duplicates";
import type { ClaimHandle, ClaimResult, ConfirmationRecord, FinalizeResult, RecoverResult } from "./confirm";
import type { DraftSettlementRef, PaymentConflict, ProposalDecisions, ProposalDocument, ProposalInput, ProposalLoad, SettlementLineRef } from "./proposal";

type Row = Record<string, unknown>;

export const PROFILE_COLUMNS = "id, company_name, mc_number, dot_number, account_type, account_role";
export const DOCUMENT_COLUMNS =
  "id, profile_id, status, document_type, extraction_version, extracted_data, content_sha256, review_status, duplicate_of, settlement_id, routing, storage_path, file_mime_type, created_at";
export const PROPOSAL_LOAD_COLUMNS =
  "id, profile_id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, destination, " +
  "total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status";

export async function getCarrierProfile(supabase: SupabaseClient, userId: string): Promise<CarrierProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CarrierProfileRow | null) ?? null;
}

export async function getProposalDocument(supabase: SupabaseClient, ownerId: string, documentId: string): Promise<(ProposalDocument & { storage_path: string | null; file_mime_type: string | null }) | null> {
  const { data, error } = await supabase.from("documents").select(DOCUMENT_COLUMNS).eq("id", documentId).eq("profile_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ProposalDocument & { storage_path: string | null; file_mime_type: string | null }) ?? null;
}

/** All reads the proposal needs, scoped to the owner. */
export async function readProposalInput(
  supabase: SupabaseClient,
  doc: ProposalDocument,
  profile: CarrierProfileRow,
  decisions: ProposalDecisions,
  today: string,
): Promise<ProposalInput> {
  const ownerId = profile.id;
  const x = sanitizePayrollExtraction(doc.extracted_data);
  const printed = [x.values.load_number, ...((x.values.reference_numbers as string[] | undefined) ?? [])]
    .map((v) => normalizeIdentifier(v)).filter((v): v is string => !!v).slice(0, 4);

  // Candidate loads: loose server filter, EXACT normalized match in code.
  const loadMap = new Map<string, ProposalLoad>();
  for (const n of printed) {
    const { data, error } = await supabase.from("loads").select(PROPOSAL_LOAD_COLUMNS)
      .ilike("load_number", looseIdentifierPattern(n)).eq("profile_id", ownerId).limit(50);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as unknown as ProposalLoad[]) loadMap.set(l.id, l);
  }
  const loads = [...loadMap.values()];
  const loadIds = loads.map((l) => l.id);

  const [drv, lines, conflicts, docs, sha] = await Promise.all([
    supabase.from("drivers").select("id, profile_id, name, cdl_number, cdl_state, active").eq("profile_id", ownerId).limit(500),
    loadIds.length
      ? supabase.from("settlement_loads").select("settlement_id, load_id, is_adjustment, settlements!inner(status, is_estimate, profile_id)").in("load_id", loadIds).eq("profile_id", ownerId)
      : Promise.resolve({ data: [], error: null }),
    loadIds.length
      ? supabase.rpc("sph_loads_payment_conflicts", { p_load_ids: loadIds })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("documents").select("id, profile_id, content_sha256, review_status, duplicate_of, extraction_version, extracted_data")
      .eq("profile_id", ownerId).eq("extraction_version", "v3").neq("id", doc.id).limit(1000),
    doc.content_sha256
      ? supabase.from("documents").select("id, profile_id, content_sha256, review_status, duplicate_of").eq("profile_id", ownerId).eq("content_sha256", doc.content_sha256).neq("id", doc.id).limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [drv, lines, conflicts, docs, sha]) if (r.error) throw new Error(r.error.message);

  const settlementLines: SettlementLineRef[] = ((lines.data ?? []) as Row[]).map((r) => {
    const s = (Array.isArray(r.settlements) ? r.settlements[0] : r.settlements) as Row | undefined;
    return {
      settlement_id: String(r.settlement_id), load_id: (r.load_id as string | null) ?? null, is_adjustment: r.is_adjustment === true,
      settlement_status: (s?.status as string | null) ?? null, is_estimate: s?.is_estimate === true,
    };
  });
  const paymentConflicts = new Map<string, PaymentConflict>();
  for (const c of (conflicts.data ?? []) as Row[]) paymentConflicts.set(String(c.load_id), String(c.conflict));

  const others = new Map<string, ExistingDocument>();
  for (const r of (docs.data ?? []) as Row[]) {
    const ox = sanitizePayrollExtraction(r.extracted_data);
    others.set(String(r.id), {
      id: String(r.id), profile_id: String(r.profile_id), content_sha256: (r.content_sha256 as string | null) ?? null,
      document_identity: documentIdentity(ox.document_type, ox.values, ox.issuer?.name ?? null),
      review_status: (r.review_status as string | null) ?? null, duplicate_of: (r.duplicate_of as string | null) ?? null,
    });
  }
  for (const r of (sha.data ?? []) as Row[]) {
    if (others.has(String(r.id))) continue;
    others.set(String(r.id), {
      id: String(r.id), profile_id: String(r.profile_id), content_sha256: (r.content_sha256 as string | null) ?? null,
      document_identity: null, review_status: (r.review_status as string | null) ?? null, duplicate_of: (r.duplicate_of as string | null) ?? null,
    });
  }

  // Editable drafts of the load's driver(s).
  const driverIds = [...new Set(loads.map((l) => l.driver_id).filter((v): v is string => !!v))];
  let drafts: DraftSettlementRef[] = [];
  if (driverIds.length) {
    const { data, error } = await supabase.from("settlements")
      .select("id, profile_id, driver_id, settlement_period_start, settlement_period_end, status, updated_at, settlement_number, is_estimate")
      .eq("profile_id", ownerId).in("driver_id", driverIds).in("status", ["draft", "ready_for_review"]).limit(200);
    if (error) throw new Error(error.message);
    drafts = ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id), profile_id: String(r.profile_id), driver_id: (r.driver_id as string | null) ?? null,
      period_start: (r.settlement_period_start as string | null) ?? null, period_end: (r.settlement_period_end as string | null) ?? null,
      status: (r.status as string | null) ?? null, updated_at: (r.updated_at as string | null) ?? null,
      settlement_number: (r.settlement_number as string | null) ?? null, is_estimate: r.is_estimate === true,
    }));
  }

  return {
    ownerId, today, document: doc, identity: carrierIdentityFromProfile(profile),
    loads, drivers: (drv.data ?? []) as unknown as DriverCandidate[], settlementLines, drafts,
    paymentConflicts, otherDocuments: [...others.values()], decisions,
  };
}

/** Same shape the settlement editor sends (SettlementEditor.toPayload). */
export function bundleToEditPayload(b: SettlementBundle): EditPayload {
  return {
    header: {
      periodStart: b.header.periodStart ?? "", periodEnd: b.header.periodEnd ?? "",
      settlementNumber: b.header.settlementNumber ?? "", settlementType: b.header.settlementType ?? "company_driver",
      truckNumber: b.header.truckNumber ?? "", payRule: b.header.payRule, payOnGrossRevenue: b.header.payOnGrossRevenue !== false,
      hoursWorked: b.header.hoursWorked ?? "", notes: b.header.notes ?? "",
    },
    loadLines: b.loadLines, additions: b.additions, deductions: b.deductions,
  };
}

/** Appends the load exactly like the editor's "Add load" and saves through saveSettlementAction. */
export async function addLoadToDraftVia(
  supabase: SupabaseClient,
  ownerId: string,
  save: (id: string, expectedUpdatedAt: string | null, payload: EditPayload) => Promise<{ ok: true } | { ok: false; error: string }>,
  settlementId: string,
  expectedUpdatedAt: string | null,
  loadId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadBundle(supabase, settlementId);
  if (!loaded || loaded.bundle.header.profileId !== ownerId) return { ok: false, error: "Settlement not found." };
  const b = loaded.bundle;
  if (isWebEditLocked(b.header.status)) return { ok: false, error: "That settlement is locked." };
  if (b.loadLines.some((l) => l.loadId === loadId && !l.isAdjustment)) return { ok: false, error: "This load is already on that settlement." };
  const { data, error } = await supabase.from("loads").select(PROPOSAL_LOAD_COLUMNS).eq("id", loadId).eq("profile_id", ownerId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Load not found." };
  const next: SettlementBundle = { ...b, loadLines: [...b.loadLines, lineFromLoad(data as unknown as LoadRow, b.loadLines.length)] };
  return save(settlementId, expectedUpdatedAt, bundleToEditPayload(next));
}

/** One conditional update: only a document not yet linked to a settlement. */
// ---- Phase 3: confirmation claims (database-enforced idempotency) -----------

interface RpcError { message?: string; hint?: string | null; code?: string | null }

/** Missing function (migration not installed) => fail closed, never unprotected. */
function isMissingFunction(e: RpcError): boolean {
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? "");
}

export const CLAIM_UNAVAILABLE = "Confirmation is unavailable until the Smart Payroll Upload database update is installed. Nothing was saved.";

/** sph:<code> from the HINT, else a generic code. Messages come from the database and are carrier-facing. */
export function claimErrorOf(e: RpcError, fallback: string): { code: string; error: string } {
  if (isMissingFunction(e)) return { code: "claim_unavailable", error: CLAIM_UNAVAILABLE };
  const m = /^sph:([a-z_]+)$/.exec(e.hint ?? "");
  return { code: m ? m[1] : fallback, error: e.message || "Nothing was saved. Reload and try again." };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function claimVia(
  supabase: SupabaseClient,
  input: { documentId: string; loadId: string; plan: "create" | "add_to_draft"; targetSettlementId: string | null; confirmation: ConfirmationRecord },
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("sph_payroll_claim", {
    p: {
      document_id: input.documentId, load_id: input.loadId, plan: input.plan,
      target_settlement_id: input.targetSettlementId, confirmation: input.confirmation,
    },
  });
  if (error) return { ok: false, ...claimErrorOf(error, "claim_refused") };
  const r = (data ?? {}) as Row;
  if (typeof r.claim_id !== "string" || typeof r.claim_token !== "string" || !UUID_RE.test(r.claim_id) || !UUID_RE.test(r.claim_token)) {
    return { ok: false, code: "claim_refused", error: "Unexpected response from the database. Nothing was saved." };
  }
  return { ok: true, claimId: r.claim_id, claimToken: r.claim_token };
}

export async function releaseClaimVia(supabase: SupabaseClient, claim: ClaimHandle, reason: string): Promise<void> {
  // Best effort: if this fails the claim simply expires (120 s).
  await supabase.rpc("sph_payroll_claim_release", { p: { claim_id: claim.claimId, claim_token: claim.claimToken, reason } });
}

export async function finalizeClaimVia(
  supabase: SupabaseClient,
  claim: ClaimHandle,
  settlementId: string,
  confirmation: ConfirmationRecord,
): Promise<FinalizeResult> {
  const { data, error } = await supabase.rpc("sph_payroll_claim_finalize", {
    p: { claim_id: claim.claimId, claim_token: claim.claimToken, settlement_id: settlementId, confirmation },
  });
  if (error) return { ok: false, ...claimErrorOf(error, "finalize_refused") };
  const r = (data ?? {}) as Row;
  if (typeof r.settlement_load_id !== "string") return { ok: false, code: "finalize_refused", error: "Unexpected response from the database." };
  return { ok: true, settlementLoadId: r.settlement_load_id };
}

export async function recoverVia(supabase: SupabaseClient, documentId: string): Promise<RecoverResult> {
  const { data, error } = await supabase.rpc("sph_payroll_claim_recover", { p: { document_id: documentId } });
  if (error) return { ok: false, ...claimErrorOf(error, "recover_failed") };
  const r = (data ?? {}) as Row;
  switch (r.state) {
    case "none": case "released": case "ambiguous":
      return { ok: true, state: r.state };
    case "linked": case "recovered":
      if (typeof r.settlement_id !== "string") break;
      return {
        ok: true, state: r.state, settlementId: r.settlement_id,
        settlementLoadId: typeof r.settlement_load_id === "string" ? r.settlement_load_id : undefined,
      };
  }
  return { ok: false, code: "recover_failed", error: "Unexpected response from the database." };
}
