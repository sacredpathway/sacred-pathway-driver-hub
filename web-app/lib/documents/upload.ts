// =============================================================================
//  Document upload registration (web)
// -----------------------------------------------------------------------------
//  1. hash the bytes (SHA-256, Web Crypto — works in Workers and Node)
//  2. store the object under "<profile_id>/<uuid>.<ext>" (bucket RLS rule)
//  3. insert the documents row: status 'pending', source 'web', hash, size,
//     MIME, optional upload type hint, optional user-selected load
//  4. same bytes uploaded before by this account => row is still created
//     (never refused, never deleted) but marked duplicate_of + needs_review,
//     and it is NOT sent to extraction automatically
//
//  The caller then triggers extraction for every non-duplicate row. Nothing
//  here depends on a bucket watcher: there is none.
// =============================================================================

import { REVIEW_REASON_TEXT, type RoutingRecord } from "./types";
import { routableDocumentType } from "./taxonomy";

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadDeps {
  ownerId: string;
  now(): Date;
  newId(): string;
  storeObject(path: string, file: Blob, contentType: string): Promise<{ error: string | null }>;
  removeObject(path: string): Promise<void>;
  findByHash(hash: string): Promise<{ id: string } | null>;
  insertDocument(row: Record<string, unknown>): Promise<{ error: string | null }>;
}

export interface UploadedDocument {
  id: string;
  name: string;
  duplicateOf: string | null;
}

export function duplicateRouting(now: Date, duplicateOf: string): RoutingRecord {
  return {
    version: 1,
    decided_at: now.toISOString(),
    type: "other",
    classification: { score: 0, band: "low", model_confidence: null, missing_required: [], rejected_keys: [] },
    match: null,
    decision: "review",
    reasons: ["duplicate_file"],
    proposed: null,
    applied: [],
    history: [{ at: now.toISOString(), by: "automation", event: "duplicate_file", detail: `${REVIEW_REASON_TEXT.duplicate_file} (${duplicateOf})` }],
  };
}

export async function registerUpload(
  deps: UploadDeps,
  file: { name: string; type: string; size: number; blob: Blob; bytes: ArrayBuffer },
  ext: string,
  opts: { typeHint: string | null; loadId: string | null },
): Promise<{ ok: true; doc: UploadedDocument } | { ok: false; error: string }> {
  const hash = await sha256Hex(file.bytes);
  const id = deps.newId().toLowerCase();
  const path = `${deps.ownerId.toLowerCase()}/${id}.${ext}`;
  const prior = await deps.findByHash(hash);

  const stored = await deps.storeObject(path, file.blob, file.type);
  if (stored.error) return { ok: false, error: `${file.name}: ${stored.error}` };

  const hint = opts.typeHint ? routableDocumentType(opts.typeHint) : null;
  const row: Record<string, unknown> = {
    id,
    profile_id: deps.ownerId,
    load_id: opts.loadId,
    document_type: hint && hint !== "other" ? hint : null,
    storage_path: path,
    status: "pending",
    processed: false,
    source: "web",
    content_sha256: hash,
    file_mime_type: file.type,
    file_size: file.size,
  };
  if (prior) {
    row.duplicate_of = prior.id;
    row.review_status = "needs_review";
    row.routing = duplicateRouting(deps.now(), prior.id);
  }
  const ins = await deps.insertDocument(row);
  if (ins.error) {
    await deps.removeObject(path); // best effort: don't orphan the object
    return { ok: false, error: `${file.name}: ${ins.error}` };
  }
  return { ok: true, doc: { id, name: file.name, duplicateOf: prior?.id ?? null } };
}
