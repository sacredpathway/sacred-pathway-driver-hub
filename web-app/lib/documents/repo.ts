// =============================================================================
//  Document automation — Supabase implementation of DocumentRepo
// -----------------------------------------------------------------------------
//  Uses the signed-in user's client (cookie session), so every read and write
//  is under RLS (profile_id = auth.uid()). Ownership is ALSO filtered in code
//  (`profile_id = ownerId`) as defence in depth. No service role anywhere in
//  the web app; the OpenAI key lives only in the Edge Function.
// =============================================================================

import { webExtractionVersion } from "./versions";
import { carrierIdentityFromProfile } from "../payrollUpload/carrierIdentity";
import { autoLoadCreationEnabled } from "../payrollUpload/featureFlag";
import { assertLoadColumns } from "@/lib/loads/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, type ActivityAction } from "@/lib/activity/log";
import type { DocumentRepo, ExtractorResult, InsertResult } from "./pipeline";
import type {
  AutomationDocument,
  ComplianceDraft,
  DriverCandidate,
  ExpenseDraft,
  ExpenseSimilar,
  LoadCandidate,
  ReviewStatus,
  RoutingRecord,
} from "./types";

export const AUTOMATION_DOCUMENT_COLUMNS =
  "id, profile_id, load_id, document_type, storage_path, status, extracted_data, extraction_version, " +
  "review_status, routing, duplicate_of, content_sha256, source, updated_at, error_message, settlement_id";

const LOAD_COLUMNS =
  "id, profile_id, load_number, broker_name, pickup_date, delivery_date, origin, destination, total_revenue, status";

// settlement_loads has TWO foreign keys to settlements (settlement_id and
// corrects_settlement_id); PostgREST refuses an unqualified embed. Name the
// line's own settlement explicitly.
export const FINALIZED_SETTLEMENT_LINES_SELECT = "id, settlements!settlement_loads_settlement_id_fkey!inner(status)";
export const FINALIZED_SETTLEMENT_STATUSES = ["approved", "paid"];

/** The approved/paid-settlement check could not be completed (query error). */
export class SettlementCheckError extends Error {
  constructor(detail: string) {
    super(`settlement check failed: ${detail}`);
    this.name = "SettlementCheckError";
  }
}

const EXPENSE_SNAPSHOT_KEYS =["category", "amount", "vendor_name", "receipt_date", "description", "load_id"] as const;
const COMPLIANCE_SNAPSHOT_KEYS = ["driver_id", "document_kind", "title", "issue_date", "expiration_date"] as const;

/** Builds an ilike pattern that matches any spelling of a normalised id ("RC1001" -> "%R%C%1%0%0%1%"). */
export function looseIdentifierPattern(normalised: string): string {
  return "%" + normalised.replace(/[^A-Z0-9]/g, "").split("").join("%") + "%";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

export function snapshotMatches(row: Record<string, unknown>, snap: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((k) => sameValue(row[k], snap[k]));
}

function classifyInsertError(err: { code?: string; message?: string } | null): InsertResult<never> {
  const message = err?.message ?? "insert failed";
  if (err?.code === "23505") return { ok: false, code: "unique", message };
  if (message.includes("document_automation_load_protected")) return { ok: false, code: "protected", message };
  return { ok: false, code: "error", message };
}

async function extractorError(error: unknown): Promise<ExtractorResult> {
  // FunctionsHttpError carries the Response in `context`.
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { code?: string; message?: string };
      return { ok: false, code: body.code, message: body.message };
    } catch {
      /* fall through */
    }
  }
  return { ok: false, code: "UNKNOWN_SCAN_ERROR", message: (error as Error)?.message ?? "Extraction failed." };
}

export function createDocumentRepo(supabase: SupabaseClient, ownerId: string): DocumentRepo {
  return {
    ownerId,
    now: () => new Date(),

    async getDocument(id) {
      const { data } = await supabase.from("documents").select(AUTOMATION_DOCUMENT_COLUMNS).eq("id", id).eq("profile_id", ownerId).maybeSingle();
      return (data as unknown as AutomationDocument) ?? null;
    },

    autoCreateLoads: autoLoadCreationEnabled(process.env),

    async carrierIdentity() {
      const { data } = await supabase.from("profiles").select("id, company_name, mc_number, dot_number, account_type, account_role").eq("id", ownerId).maybeSingle();
      return carrierIdentityFromProfile((data as never) ?? null);
    },

    async createLoad(row, documentId) {
      // Only path: the database serialises "create unless this carrier already
      // has the number" (migration #5). If the function is missing, nothing is
      // written and the rate con waits for a person (no unguarded insert).
      // Migration #6: the database re-verifies the document itself and takes
      // every load value from its server-written extraction snapshot, so only
      // the document and the chosen driver are sent.
      assertLoadColumns({ ...row, profile_id: ownerId }, "autoCreateLoad");
      const rpc = await supabase.rpc("sph_load_create_verified", { p: { document_id: documentId, driver_id: row.driver_id } });
      if (!rpc.error) {
        const r = (rpc.data ?? {}) as { id?: unknown; created?: unknown };
        if (typeof r.id === "string") return { ok: true, id: r.id, created: r.created === true };
        return { ok: false, message: "Unexpected response creating the load." };
      }
      const code = (rpc.error as { code?: string }).code;
      const missing = code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(rpc.error.message ?? "");
      return missing
        ? { ok: false, unavailable: true, message: "sph_load_create_verified is not installed" }
        : { ok: false, message: rpc.error.message };
    },

    async listWaitingDocuments(limit) {
      const { data, error } = await supabase.from("documents").select(AUTOMATION_DOCUMENT_COLUMNS)
        .eq("profile_id", ownerId).eq("review_status", "needs_review").is("load_id", null)
        .order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomationDocument[];
    },

    async claimExtraction(id, staleBeforeIso) {
      const { data } = await 
        supabase
          .from("documents")
          .update({ status: "processing", error_message: null, updated_at: new Date().toISOString() })
          .eq("id", id).eq("profile_id", ownerId)
        .is("review_status", null)
        .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${staleBeforeIso})`)
        .select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async invokeExtractor(id, typeHint) {
      const { data, error } = await supabase.functions.invoke("extract-document", {
        body: { document_id: id, extraction_version: webExtractionVersion(process.env), ...(typeHint ? { type_hint: typeHint } : {}) },
      });
      if (error) return extractorError(error);
      const body = data as { success?: boolean; code?: string; message?: string } | null;
      return body?.success ? { ok: true } : { ok: false, code: body?.code, message: body?.message };
    },

    async markExtractionFailed(id, message) {
      await 
        supabase.from("documents").update({ status: "failed", error_message: message.slice(0, 1000) }).eq("id", id).eq("profile_id", ownerId).neq("status", "processed");
    },

    async resetForRetry(id, routing) {
      const { data } = await 
        supabase
          .from("documents")
          .update({ status: "pending", review_status: null, routing, error_message: null })
          .eq("id", id).eq("profile_id", ownerId)
        .or("review_status.is.null,review_status.eq.needs_review")
        .neq("status", "processing")
        .select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async findLoadCandidates(identifiers) {
      const out = new Map<string, LoadCandidate>();
      for (const n of identifiers.slice(0, 3)) {
        const { data } = await supabase.from("loads").select(LOAD_COLUMNS).ilike("load_number", looseIdentifierPattern(n)).eq("profile_id", ownerId)
          .limit(50);
        for (const l of (data ?? []) as unknown as LoadCandidate[]) out.set(l.id, l);
      }
      return Array.from(out.values());
    },

    async getLoad(id) {
      const { data } = await supabase.from("loads").select(LOAD_COLUMNS).eq("id", id).eq("profile_id", ownerId).maybeSingle();
      return (data as unknown as LoadCandidate) ?? null;
    },

    async protectedLoadIds(ids) {
      const result = new Set<string>();
      if (ids.length === 0) return result;
      const { data } = await supabase.from("loads").select("id, status").in("id", ids).eq("profile_id", ownerId);
      const visible = new Set<string>();
      for (const l of (data ?? []) as Array<{ id: string; status: string | null }>) {
        visible.add(l.id);
        if (["settled", "cancelled", "canceled"].includes(String(l.status ?? "").toLowerCase())) result.add(l.id);
      }
      await Promise.all(
        ids.map(async (id) => {
          if (!visible.has(id)) {
            result.add(id); // not visible => never safe to touch
            return;
          }
          const { data: paid, error } = await supabase.rpc("sph_load_paid_elsewhere", { p_load_id: id, p_exclude_paystub_id: null });
          if (error || paid === true) result.add(id); // unknown => protected
        }),
      );
      return result;
    },

    async listDrivers() {
      const { data } = await supabase.from("drivers").select("id, profile_id, name, cdl_number, cdl_state, active").eq("profile_id", ownerId).limit(500);
      return (data ?? []) as unknown as DriverCandidate[];
    },

    async findSimilarExpenses(amount, date) {
      const { data } = await 
        supabase
          .from("expenses")
          .select("id, amount, receipt_date, vendor_name, source_document_id")
          .eq("receipt_date", date).eq("profile_id", ownerId)
        .gte("amount", Math.round(amount * 100) / 100 - 0.005)
        .lte("amount", Math.round(amount * 100) / 100 + 0.005)
        .limit(20);
      return (data ?? []) as unknown as ExpenseSimilar[];
    },

    async claimRouting(id, status: ReviewStatus, routing: RoutingRecord) {
      const { data } = await supabase.from("documents").update({ review_status: status, routing }).eq("id", id).eq("profile_id", ownerId)
        .is("review_status", null)
        .select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async saveRouting(id, status, routing, reviewed) {
      await 
        supabase
          .from("documents")
          .update({ review_status: status, routing, ...(reviewed ? { reviewed_at: new Date().toISOString() } : {}) })
          .eq("id", id).eq("profile_id", ownerId);
    },

    async setDocumentLoad(id, loadId, expectedCurrent) {
      let q = supabase.from("documents").update({ load_id: loadId }).eq("id", id).eq("profile_id", ownerId);
      q = expectedCurrent === null ? q.is("load_id", null) : q.eq("load_id", expectedCurrent);
      const { data } = await q.select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async insertExpense(documentId, d: ExpenseDraft) {
      const { data, error } = await supabase
        .from("expenses")
        .insert({
          profile_id: ownerId,
          load_id: d.load_id,
          category: d.category,
          amount: d.amount,
          vendor_name: d.vendor_name,
          description: d.description,
          receipt_date: d.receipt_date,
          source_document_id: documentId,
        })
        .select("id, category, amount, vendor_name, receipt_date, description, load_id")
        .single();
      if (error || !data) return classifyInsertError(error);
      return { ok: true, row: data as Record<string, unknown> };
    },

    async getExpenseBySource(documentId) {
      const { data } = await 
        supabase
          .from("expenses")
          .select("id, category, amount, vendor_name, receipt_date, description, load_id")
          .eq("source_document_id", documentId).eq("profile_id", ownerId).maybeSingle();
      return (data as Record<string, unknown>) ?? null;
    },

    async deleteExpenseIfUnchanged(id, documentId, snapshot) {
      const { data: row } = await 
        supabase.from("expenses").select("*").eq("id", id).eq("source_document_id", documentId).eq("profile_id", ownerId).maybeSingle();
      if (!row || !snapshotMatches(row as Record<string, unknown>, snapshot, EXPENSE_SNAPSHOT_KEYS)) return false;
      const { data } = await supabase.from("expenses").delete().eq("id", id).eq("source_document_id", documentId).eq("profile_id", ownerId).select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async insertDriverDocument(doc, d: ComplianceDraft) {
      const { data, error } = await supabase
        .from("compliance_documents")
        .insert({
          profile_id: ownerId,
          category: "driver",
          title: d.title,
          storage_path: doc.storage_path,
          issue_date: d.issue_date,
          expiration_date: d.expiration_date,
          notes: "Filed automatically from an uploaded document.",
          driver_id: d.driver_id,
          document_kind: d.document_kind,
          source_document_id: doc.id,
        })
        .select("id, driver_id, document_kind, title, issue_date, expiration_date")
        .single();
      if (error || !data) return classifyInsertError(error);
      return { ok: true, row: data as Record<string, unknown> };
    },

    async getDriverDocumentBySource(documentId) {
      const { data } = await 
        supabase
          .from("compliance_documents")
          .select("id, driver_id, document_kind, title, issue_date, expiration_date")
          .eq("source_document_id", documentId).eq("profile_id", ownerId).maybeSingle();
      return (data as Record<string, unknown>) ?? null;
    },

    async deleteDriverDocumentIfUnchanged(id, documentId, snapshot) {
      const { data: row } = await 
        supabase.from("compliance_documents").select("*").eq("id", id).eq("source_document_id", documentId).eq("profile_id", ownerId).maybeSingle();
      if (!row || !snapshotMatches(row as Record<string, unknown>, snapshot, COMPLIANCE_SNAPSHOT_KEYS)) return false;
      const { data } = await 
        supabase.from("compliance_documents").delete().eq("id", id).eq("source_document_id", documentId).eq("profile_id", ownerId).select("id");
      return Array.isArray(data) && data.length === 1;
    },

    async documentInFinalizedSettlement(documentId) {
      const { data, error } = await
        supabase
          .from("settlement_loads")
          .select(FINALIZED_SETTLEMENT_LINES_SELECT)
          .or(`rate_confirmation_document_id.eq.${documentId},proof_of_delivery_document_id.eq.${documentId}`).eq("profile_id", ownerId).in("settlements.status", FINALIZED_SETTLEMENT_STATUSES);
      // Fail closed: if the check can't run, the caller must not proceed.
      if (error || !Array.isArray(data)) throw new SettlementCheckError(error?.message ?? "no result");
      return data.length > 0;
    },

    async log(entityId, action, metadata) {
      await logActivity(supabase, ownerId, {
        entityType: "document",
        entityId,
        action: action as ActivityAction,
        metadata,
      });
    },
  };
}
