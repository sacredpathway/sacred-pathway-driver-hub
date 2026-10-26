// =============================================================================
//  Document server actions — upload, automation, review, undo, delete
// -----------------------------------------------------------------------------
//  Storage path scheme MIRRORS the iOS app:
//      "<profile_id_lowercase>/<uuid_lowercase>.<ext>"
//  (the bucket RLS rule (storage.foldername(name))[1] = auth.uid()::text only
//  matches lowercase).
//
//  There is NO bucket watcher. The iPhone calls `extract-document` itself;
//  the website triggers it explicitly: UploadCard calls
//  processDocumentAction() for every new, non-duplicate upload, and the review
//  queue offers "Extract now" / "Retry" for anything still pending or failed.
//  Extraction runs in the Edge Function (OpenAI key server-side); routing
//  runs here under the signed-in user's RLS (lib/documents/pipeline.ts).
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";
import { buildCreateLoadPayload } from "@/lib/loads/payloads";
import { assertLoadColumns } from "@/lib/loads/schema";
import { FieldError } from "@/lib/loads/formFields";
import { createDocumentRepo } from "@/lib/documents/repo";
import {
  approveDocument,
  dismissDocument,
  processDocument,
  retryDocument,
  reviseDocument,
  undoAction,
  type ProcessOutcome,
} from "@/lib/documents/pipeline";
import { effectiveExtraction } from "@/lib/documents/routing";
import { normalizeIdentifier } from "@/lib/documents/matching";
import { registerUpload, type UploadedDocument } from "@/lib/documents/upload";
import { isCanonicalDocumentType } from "@/lib/documents/taxonomy";
import { FIELD_SPECS } from "@/lib/documents/extraction";
import type { RoutingRecord } from "@/lib/documents/types";
import { UPLOAD_TYPE_CHOICES } from "./constants";
import { createSettlementAction, saveSettlementAction } from "@/app/(app)/settlements/actions";
import { afterFiling, runAutoPayroll, summary, type AutopaySummary } from "@/lib/autopay/server";

const SETTLEMENT_ACTIONS = { createSettlementAction, saveSettlementAction };

function revalidatePayroll() {
  revalidatePath("/settlements");
  revalidatePath("/payroll");
  revalidatePath("/dashboard");
}

/** Payroll effect of a freshly filed document, plus anything that was waiting for its load. */
async function payrollAfterFiling(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null },
  documentId: string,
): Promise<AutopaySummary | undefined> {
  try {
    const { data } = await supabase.from("documents").select("load_id").eq("id", documentId).eq("profile_id", user.id).maybeSingle();
    const loadId = ((data as { load_id?: string | null } | null)?.load_id) ?? null;
    const r = await afterFiling(supabase, { id: user.id, email: user.email ?? null }, documentId, SETTLEMENT_ACTIONS, loadId);
    revalidatePayroll();
    return r.own.state === "off" || r.own.state === "skipped" ? undefined : summary(r.own);
  } catch {
    // Filing already succeeded; payroll can be retried from the document.
    return undefined;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

function uuidOrNull(raw: string | null): string | null {
  if (raw === null) return null;
  if (!UUID_RE.test(raw)) throw new Error("Invalid id.");
  return raw.toLowerCase();
}

// MIME allowlist mirrors the iOS uploader + bucket: images and PDFs.
const ALLOWED_MIMES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (bucket file_size_limit)

function extFromName(name: string, mime: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  if (m) return m[1].toLowerCase();
  switch (mime) {
    case "image/png":           return "png";
    case "image/jpeg":
    case "image/jpg":           return "jpg";
    case "image/webp":          return "webp";
    case "image/heic":          return "heic";
    case "image/heif":          return "heif";
    case "application/pdf":     return "pdf";
    default:                    return "bin";
  }
}

export type DocumentActionState =
  | { ok: true; uploaded: number; documents: UploadedDocument[]; warning?: string }
  | { ok: false; error: string; field?: string; documents?: UploadedDocument[] };

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// =============================================================================
//  UPLOAD — multi-file; partial success is reported, never hidden
// =============================================================================

export async function uploadDocumentsAction(
  _prev: DocumentActionState | undefined,
  formData: FormData
): Promise<DocumentActionState> {
  const typeHint = s(formData, "document_type");
  if (typeHint && !UPLOAD_TYPE_CHOICES.includes(typeHint)) {
    return { ok: false, error: "Unknown document type.", field: "document_type" };
  }
  let loadId: string | null;
  try {
    loadId = uuidOrNull(s(formData, "load_id"));
  } catch {
    return { ok: false, error: "Load is invalid.", field: "load_id" };
  }

  const files = formData.getAll("files").filter(
    (f): f is File => f instanceof File && f.size > 0
  );
  if (files.length === 0) {
    return { ok: false, error: "Pick at least one file to upload.", field: "files" };
  }

  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Not signed in." };

  // Never trust a client-supplied load id: it must be visible under RLS AND ours.
  if (loadId) {
    const { data: load } = await supabase
      .from("loads").select("id").eq("id", loadId).eq("profile_id", user.id).maybeSingle();
    if (!load) {
      return { ok: false, error: "Selected load isn't in your account.", field: "load_id" };
    }
  }

  const deps = {
    ownerId: user.id,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    async storeObject(path: string, blob: Blob, contentType: string) {
      const { error } = await supabase.storage.from("documents")
        .upload(path, blob, { upsert: false, contentType, cacheControl: "3600" });
      return { error: error?.message ?? null };
    },
    async removeObject(path: string) {
      await supabase.storage.from("documents").remove([path]);
    },
    async findByHash(hash: string) {
      const { data } = await supabase.from("documents").select("id")
        .eq("profile_id", user.id).eq("content_sha256", hash)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      return (data as { id: string } | null) ?? null;
    },
    async insertDocument(row: Record<string, unknown>) {
      const { error } = await supabase.from("documents").insert(row);
      return { error: error?.message ?? null };
    },
  };

  const errors: string[] = [];
  const documents: UploadedDocument[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: too large (max 20 MB).`);
      continue;
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      errors.push(`${file.name}: unsupported type (${file.type || "unknown"}).`);
      continue;
    }
    const res = await registerUpload(
      deps,
      { name: file.name, type: file.type, size: file.size, blob: file, bytes: await file.arrayBuffer() },
      extFromName(file.name, file.type),
      { typeHint, loadId },
    );
    if (res.ok) documents.push(res.doc);
    else errors.push(res.error);
  }

  if (documents.length > 0) {
    await logActivity(supabase, user.id, {
      entityType: "document",
      entityId: null,
      action: "uploaded",
      metadata: {
        label: `${documents.length} ${documents.length === 1 ? "document" : "documents"} uploaded`,
        count: documents.length,
        duplicates: documents.filter((d) => d.duplicateOf).length,
        load_id: loadId,
      },
    });
  }
  revalidatePath("/documents");

  if (documents.length === 0) {
    return { ok: false, error: errors.length > 0 ? errors.join("\n") : "No files uploaded." };
  }
  const dupes = documents.filter((d) => d.duplicateOf).length;
  const warning = [
    errors.length ? `Uploaded ${documents.length} of ${documents.length + errors.length}.\n${errors.join("\n")}` : "",
    dupes ? `${dupes} ${dupes === 1 ? "file was" : "files were"} uploaded before — sent to review, not read again.` : "",
  ].filter(Boolean).join("\n");
  return { ok: true, uploaded: documents.length, documents, ...(warning ? { warning } : {}) };
}

// =============================================================================
//  AUTOMATION — extract + route one document (called right after upload)
// =============================================================================

export type ProcessActionResult =
  | { ok: true; state: ProcessOutcome["state"]; message: string; payroll?: AutopaySummary }
  | { ok: false; error: string };

function outcomeMessage(o: ProcessOutcome): string {
  switch (o.state) {
    case "auto_routed": return "Read and filed automatically.";
    case "needs_review": return "Read — waiting for your review.";
    case "failed": return `Could not read: ${o.message}`;
    case "busy": return "Already being read.";
    case "skipped": return o.reason === "duplicate" ? "Duplicate — in review." : "Nothing to do.";
  }
}

export async function processDocumentAction(documentId: string): Promise<ProcessActionResult> {
  if (!UUID_RE.test(documentId ?? "")) return { ok: false, error: "Invalid document id." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Not signed in." };
  const id = documentId.toLowerCase();
  const outcome = await processDocument(createDocumentRepo(supabase, user.id), id);
  const payroll = outcome.state === "auto_routed" ? await payrollAfterFiling(supabase, user, id) : undefined;
  revalidatePath("/documents");
  return { ok: true, state: outcome.state, message: outcomeMessage(outcome), ...(payroll ? { payroll } : {}) };
}

/** "Try payroll again" — re-runs the automatic payroll step for one filed document. */
export async function runAutoPayrollAction(documentId: string): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId ?? "")) return { ok: false, message: "Invalid document id." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, message: "Not signed in." };
  const o = await runAutoPayroll(supabase, { id: user.id, email: user.email ?? null }, documentId.toLowerCase(), SETTLEMENT_ACTIONS);
  revalidatePath("/documents");
  revalidatePayroll();
  if (o.state === "off") return { ok: false, message: "Automatic payroll drafts are not enabled here." };
  if (o.state === "skipped") return { ok: true, message: "Nothing to do for payroll." };
  return { ok: o.state !== "held" && o.state !== "error", message: summary(o).message };
}

// =============================================================================
//  REVIEW QUEUE — every consequential change here is an explicit human action
// =============================================================================

export type ReviewActionState = { ok: boolean; message: string } | undefined;

async function reviewRepo() {
  const { supabase, user } = await signedIn();
  if (!user) return null;
  return { supabase, user, repo: createDocumentRepo(supabase, user.id) };
}

/** Correct type / fields / pick load or driver. Re-proposes; applies nothing. */
export async function reviseDocumentAction(
  documentId: string,
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId)) return { ok: false, message: "Invalid document id." };
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  let loadId: string | null;
  let driverId: string | null;
  try {
    loadId = uuidOrNull(s(formData, "load_id"));
    driverId = uuidOrNull(s(formData, "driver_id"));
  } catch {
    return { ok: false, message: "Invalid load or driver." };
  }
  const type = s(formData, "document_type");
  if (type && !isCanonicalDocumentType(type)) return { ok: false, message: "Unknown document type." };
  const corrections: Record<string, string | number | boolean> = {};
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("field_") || typeof v !== "string") continue;
    const key = k.slice(6);
    if (!/^[a-z_]{1,40}$/.test(key)) continue;
    const spec = FIELD_SPECS[key];
    if (!spec) continue; // only known fields; the sanitiser re-validates values
    const t = v.trim();
    if (t === "") continue;
    if (spec.kind === "money" || spec.kind === "count") corrections[key] = Number(t.replace(/[$,\s]/g, ""));
    else if (spec.kind === "bool") corrections[key] = t === "true";
    else corrections[key] = t;
  }
  // Corrections pass through the same sanitiser as AI output (effectiveExtraction).
  const res = await reviseDocument(ctx.repo, documentId.toLowerCase(), { type, corrections, loadId, driverId });
  revalidatePath("/documents");
  return res.ok ? { ok: true, message: "Saved. Review the proposal, then approve." } : { ok: false, message: res.error };
}

export async function approveDocumentAction(documentId: string): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId)) return { ok: false, message: "Invalid document id." };
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const res = await approveDocument(ctx.repo, documentId.toLowerCase());
  const payroll = res.ok ? await payrollAfterFiling(ctx.supabase, ctx.user, documentId.toLowerCase()) : undefined;
  revalidatePath("/documents");
  revalidatePath("/expenses");
  revalidatePath("/loads");
  if (!res.ok) return { ok: false, message: res.error };
  return { ok: true, message: payroll?.message ? `Approved and filed. ${payroll.message}` : "Approved and filed." };
}

export async function dismissDocumentAction(documentId: string): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId)) return { ok: false, message: "Invalid document id." };
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const res = await dismissDocument(ctx.repo, documentId.toLowerCase());
  revalidatePath("/documents");
  return res.ok ? { ok: true, message: "Dismissed." } : { ok: false, message: res.error };
}

export async function retryDocumentAction(documentId: string): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId)) return { ok: false, message: "Invalid document id." };
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const res = await retryDocument(ctx.repo, documentId.toLowerCase());
  const payroll = res.state === "auto_routed" ? await payrollAfterFiling(ctx.supabase, ctx.user, documentId.toLowerCase()) : undefined;
  revalidatePath("/documents");
  if (res.state === "refused") return { ok: false, message: res.message };
  const msg = outcomeMessage(res);
  return { ok: res.state !== "failed", message: payroll?.message ? `${msg} ${payroll.message}` : msg };
}

export async function undoDocumentAction(documentId: string, index: number): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId) || !Number.isInteger(index) || index < 0 || index > 50) {
    return { ok: false, message: "Invalid request." };
  }
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const res = await undoAction(ctx.repo, documentId.toLowerCase(), index);
  revalidatePath("/documents");
  revalidatePath("/expenses");
  revalidatePath("/loads");
  return res.ok ? { ok: true, message: "Undone. The document is back in review." } : { ok: false, message: res.error };
}

/**
 * Explicit human "Create load" for an unmatched rate confirmation. Uses the
 * same payload builder + validation as the New Load form; refuses when a load
 * with the same load number already exists (attach that one instead).
 */
export async function createLoadFromDocumentAction(
  documentId: string,
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  if (!UUID_RE.test(documentId)) return { ok: false, message: "Invalid document id." };
  const ctx = await reviewRepo();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const { supabase, user, repo } = ctx;
  const doc = await repo.getDocument(documentId.toLowerCase());
  if (!doc) return { ok: false, message: "Document not found." };
  const { extraction } = effectiveExtraction(doc.extracted_data, doc.routing?.corrections ?? null);
  if (doc.review_status !== "needs_review" || extraction.document_type !== "rate_confirmation" || doc.load_id) {
    return { ok: false, message: "Create load is only for unmatched rate confirmations in review." };
  }
  if ((doc.routing?.applied ?? []).some((a) => !a.undone_at && a.kind === "create_load")) {
    return { ok: false, message: "A load was already created from this document." };
  }

  let payload;
  try {
    ({ payload } = buildCreateLoadPayload(formData));
  } catch (e) {
    return { ok: false, message: e instanceof FieldError ? e.message : (e as Error).message };
  }
  if (!payload.load_number && !payload.broker_name && !payload.origin && !payload.destination) {
    return { ok: false, message: "Provide at least a load #, broker, origin, or destination." };
  }
  if (payload.pickup_date && payload.delivery_date && payload.delivery_date < payload.pickup_date) {
    return { ok: false, message: "Delivery date must be on or after pickup date." };
  }
  const norm = normalizeIdentifier(payload.load_number);
  if (norm) {
    const existing = (await repo.findLoadCandidates([norm])).filter((l) => normalizeIdentifier(l.load_number) === norm);
    if (existing.length > 0) {
      return { ok: false, message: `Load #${existing[0].load_number} already exists — choose it instead of creating a duplicate.` };
    }
  }
  // Driver: only one the owner confirmed in the form (pre-selected from the
  // driver printed on the document), and only one of this account's drivers.
  let driverId: string | null = null;
  try {
    driverId = uuidOrNull(s(formData, "driver_id"));
  } catch {
    return { ok: false, message: "Invalid driver." };
  }
  if (driverId) {
    const { data: drv } = await supabase.from("drivers").select("id").eq("id", driverId).eq("profile_id", user.id).maybeSingle();
    if (!drv) return { ok: false, message: "That driver isn't in your account." };
  }
  // Truck / trailer pickers are not offered here; never accept them.
  const row = { ...payload, driver_id: driverId, truck_id: null, trailer_id: null, profile_id: user.id };
  const { data: load, error } = await supabase
    .from("loads").insert(assertLoadColumns(row, "createLoadFromDocumentAction")).select("id").single();
  if (error || !load) return { ok: false, message: error?.message ?? "Could not create the load." };

  const attached = await repo.setDocumentLoad(doc.id, load.id, null);
  const at = new Date().toISOString();
  const routing: RoutingRecord = {
    ...(doc.routing as RoutingRecord),
    applied: [
      ...(doc.routing?.applied ?? []),
      { kind: "create_load", target_table: "loads", target_id: load.id, mode: "human_approved", applied_at: at, before: null, after: { load_number: payload.load_number } },
      ...(attached
        ? [{ kind: "attach_load" as const, target_table: "documents" as const, target_id: doc.id, mode: "human_approved" as const, applied_at: at, before: { load_id: null }, after: { load_id: load.id, load_number: payload.load_number } }]
        : []),
    ],
    history: [...(doc.routing?.history ?? []), { at, by: "user", event: "created_load", detail: load.id }],
  };
  await repo.saveRouting(doc.id, "approved", routing, true);
  await logActivity(supabase, user.id, {
    entityType: "load",
    entityId: load.id,
    action: "created",
    metadata: { label: `Load ${payload.load_number ? `#${payload.load_number}` : load.id.slice(0, 8)} created from a rate confirmation`, document_id: doc.id, amount: payload.total_revenue },
  });
  // The load exists now: draft its payroll and file paperwork that was waiting for it.
  const payroll = await payrollAfterFiling(supabase, user, doc.id);
  revalidatePath("/documents");
  revalidatePath("/loads");
  revalidatePath("/dashboard");
  if (payroll?.settlementId) redirect(`/settlements/${payroll.settlementId}/statement?from=document`);
  redirect(`/loads/${load.id}?created=1`);
}

// =============================================================================
//  DELETE — removes storage object + row; refused while automation actions live
// =============================================================================

export async function deleteDocumentAction(documentId: string): Promise<void> {
  if (!documentId || !UUID_RE.test(documentId)) {
    throw new Error("Missing or invalid document id.");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: row } = await supabase
    .from("documents")
    .select("id, storage_path, routing")
    .eq("id", documentId)
    .maybeSingle();
  if (!row) throw new Error("Document not found.");

  // Keep the audit trail: a document whose automatic/approved action is still
  // in effect must be undone first (or the action edited by hand).
  const live = ((row.routing as RoutingRecord | null)?.applied ?? []).filter((a) => !a.undone_at && a.kind !== "create_load");
  if (live.length > 0) {
    throw new Error("Undo this document's filed action before deleting it.");
  }

  if (row.storage_path) {
    // Non-fatal if the object is already gone — still want the DB row gone.
    await supabase.storage.from("documents").remove([row.storage_path as string]);
  }

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "document",
    entityId: documentId,
    action: "deleted",
  });

  revalidatePath("/documents");
  redirect("/documents?deleted=1");
}
