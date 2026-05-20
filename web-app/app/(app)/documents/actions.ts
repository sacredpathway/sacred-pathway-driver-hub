// =============================================================================
//  Document server actions — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Web browser upload to the existing `documents` Storage bucket (created in
//  20260417120000_openai_documents.sql) and the per-row delete.
//
//  Storage path scheme MIRRORS the iOS app:
//      "<profile_id_lowercase>/<uuid_lowercase>.<ext>"
//  iOS Swift UUIDs default to uppercase; Postgres `auth.uid()::text` is
//  lowercase, so the bucket's RLS policy (storage.foldername(name))[1] only
//  matches when both halves are lowercase. We lowercase both halves here too
//  to avoid the 403 the iOS team already hit and documented in memory.
//
//  The Edge Function `extract-document` watches the bucket and back-fills
//  extracted_data + status on insert; the web's job is only to land the
//  bytes and create the `documents` row. The Edge Function continues to
//  serve both iOS and web uploads with no changes.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FieldError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

function maybeUuid(formData: FormData, name: string, label: string): string | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  if (!UUID_RE.test(raw)) {
    throw new FieldError(name, `${label} is invalid.`);
  }
  return raw.toLowerCase();
}

// Document type taxonomy — same labels as the iOS Document Vault picker.
export const DOCUMENT_TYPES: ReadonlyArray<string> = [
  "rate_confirmation",
  "bol",
  "pod",
  "invoice",
  "receipt",
  "lumper",
  "settlement",
  "other",
] as const;

// MIME allowlist mirrors the iOS uploader: images (camera scans + photos
// from broker email) and PDFs (forwarded rate cons / invoices).
const ALLOWED_MIMES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

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

// Edge runtime lacks the `crypto.randomUUID` Node builtin on some versions;
// global crypto.randomUUID is part of the Web Crypto API and IS available on
// Cloudflare Pages edge + Node 19+, so we use it directly. Returns LOWERCASE
// UUID (matches the Storage RLS prefix rule).
function newDocId(): string {
  return crypto.randomUUID().toLowerCase();
}

export type DocumentActionState =
  | { ok: true; uploaded: number }
  | { ok: false; error: string; field?: string };

// =============================================================================
//  UPLOAD — supports multi-file from one <input type="file" multiple>
// -----------------------------------------------------------------------------
//  All-or-nothing semantics would be hostile here — partial upload is more
//  useful than failing the whole batch when one PDF is too big. We collect
//  individual failures into the returned error, but every successful upload
//  has its DB row written before the next file is attempted.
// =============================================================================

export async function uploadDocumentsAction(
  _prev: DocumentActionState | undefined,
  formData: FormData
): Promise<DocumentActionState> {
  let docType: string | null;
  let loadId: string | null;
  try {
    docType = s(formData, "document_type");
    if (docType && !DOCUMENT_TYPES.includes(docType)) {
      throw new FieldError(
        "document_type",
        `Document type must be one of: ${DOCUMENT_TYPES.join(", ")}.`
      );
    }
    loadId = maybeUuid(formData, "load_id", "Load");
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const files = formData.getAll("files").filter(
    (f): f is File => f instanceof File && f.size > 0
  );
  if (files.length === 0) {
    return { ok: false, error: "Pick at least one file to upload.", field: "files" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Pre-verify load ownership once (not per-file) when one is selected.
  if (loadId) {
    const { data: load } = await supabase
      .from("loads").select("id").eq("id", loadId).maybeSingle();
    if (!load) {
      return {
        ok: false,
        error: "Selected load isn't in your account.",
        field: "load_id",
      };
    }
  }

  const profileId = user.id.toLowerCase();
  const errors: string[] = [];
  let uploaded = 0;

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: too large (max 20 MB).`);
      continue;
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      errors.push(`${file.name}: unsupported type (${file.type || "unknown"}).`);
      continue;
    }

    const docId = newDocId();
    const ext = extFromName(file.name, file.type);
    const path = `${profileId}/${docId}.${ext}`;

    const { error: upErr } = await supabase
      .storage
      .from("documents")
      .upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: "3600",
      });
    if (upErr) {
      errors.push(`${file.name}: ${upErr.message}`);
      continue;
    }

    // Insert the documents row right after the bytes land. status defaults
    // to NULL — the extract-document Edge Function will set it to
    // 'processed' once OCR finishes (same as iOS uploads today).
    const { error: dbErr } = await supabase
      .from("documents")
      .insert({
        profile_id: user.id,
        load_id: loadId,
        document_type: docType,
        storage_path: path,
        processed: false,
      });
    if (dbErr) {
      // Storage object orphan — best effort cleanup
      await supabase.storage.from("documents").remove([path]);
      errors.push(`${file.name}: ${dbErr.message}`);
      continue;
    }

    uploaded += 1;
  }

  if (uploaded > 0) {
    await logActivity(supabase, user.id, {
      entityType: "document",
      entityId: null,
      action: "uploaded",
      metadata: {
        label: `${uploaded} ${uploaded === 1 ? "document" : "documents"} uploaded${docType ? ` (${docType})` : ""}`,
        count: uploaded,
        document_type: docType,
        load_id: loadId,
      },
    });
  }

  revalidatePath("/documents");

  if (uploaded === 0) {
    return {
      ok: false,
      error: errors.length > 0 ? errors.join("\n") : "No files uploaded.",
    };
  }
  if (errors.length > 0) {
    return {
      ok: false,
      error:
        `Uploaded ${uploaded} of ${uploaded + errors.length}.\n` +
        errors.join("\n"),
    };
  }
  return { ok: true, uploaded };
}

// =============================================================================
//  DELETE — removes storage object + row in one go
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
    .select("id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!row) throw new Error("Document not found.");

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
