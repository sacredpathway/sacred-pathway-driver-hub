// =============================================================================
//  Pending-document backfill — DRY RUN ONLY
// -----------------------------------------------------------------------------
//  For the legacy rows still `pending` (iPhone uploads from 2026-04-19). This
//  module NEVER writes: the repo is wrapped so every mutating method throws,
//  and extraction runs through the Edge Function with `persist: false`
//  (returns the sanitised result, writes nothing).
//
//  Duplicates are decided by the SHA-256 of the actual bytes, never by size.
//  Executing a real backfill is a separate, explicitly authorised step.
// =============================================================================

import { computeDecision, type DocumentRepo } from "./pipeline";
import { documentTypeLabel } from "./taxonomy";
import type { AutomationDocument, ReviewReason } from "./types";

export function readOnlyRepo(base: DocumentRepo): DocumentRepo {
  const blocked = (name: string) => async () => {
    throw new Error(`dry-run: write blocked (${name})`);
  };
  return {
    ...base,
    claimExtraction: blocked("claimExtraction"),
    invokeExtractor: blocked("invokeExtractor"),
    markExtractionFailed: blocked("markExtractionFailed"),
    resetForRetry: blocked("resetForRetry"),
    claimRouting: blocked("claimRouting"),
    saveRouting: blocked("saveRouting"),
    setDocumentLoad: blocked("setDocumentLoad"),
    insertExpense: blocked("insertExpense"),
    deleteExpenseIfUnchanged: blocked("deleteExpenseIfUnchanged"),
    insertDriverDocument: blocked("insertDriverDocument"),
    deleteDriverDocumentIfUnchanged: blocked("deleteDriverDocumentIfUnchanged"),
    log: blocked("log"),
  };
}

export interface BackfillDeps {
  /** SHA-256 of the stored object's bytes (download only). */
  hashDocument(doc: AutomationDocument): Promise<string | null>;
  /** Edge Function v2 with persist:false — returns the stored-shape extraction or an error. */
  previewExtract(doc: AutomationDocument): Promise<{ ok: true; extracted: unknown } | { ok: false; message: string }>;
}

export interface BackfillRow {
  document_id: string;
  created_at_hint: string | null;
  sha256: string | null;
  duplicate_of: string | null;
  duplicate_group_size: number;
  proposed_type: string;
  extracted_fields: Record<string, unknown>;
  classification_confidence: number;
  model_confidence: string | null;
  proposed_match: string | null;
  match_confidence: number | null;
  proposed_action: string;
  review_required: boolean;
  reasons: ReviewReason[];
  error: string | null;
}

/** Only the legacy pending rows (never web uploads, never already-processed rows). */
export function isLegacyPending(d: AutomationDocument): boolean {
  return d.status === "pending" && d.source === null && d.extraction_version === null && d.review_status === null;
}

export async function planBackfill(
  base: DocumentRepo,
  docs: readonly AutomationDocument[],
  deps: BackfillDeps,
  opts: { extract: boolean } = { extract: true },
): Promise<BackfillRow[]> {
  const repo = readOnlyRepo(base);
  const targets = docs.filter(isLegacyPending);

  const hashes = new Map<string, string | null>();
  for (const d of targets) hashes.set(d.id, await deps.hashDocument(d));
  const firstByHash = new Map<string, string>();
  const groupSize = new Map<string, number>();
  for (const d of targets) {
    const h = hashes.get(d.id);
    if (!h) continue;
    if (!firstByHash.has(h)) firstByHash.set(h, d.id);
    groupSize.set(h, (groupSize.get(h) ?? 0) + 1);
  }

  const rows: BackfillRow[] = [];
  for (const d of targets) {
    const h = hashes.get(d.id) ?? null;
    const dupOf = h && firstByHash.get(h) !== d.id ? firstByHash.get(h)! : null;
    const row: BackfillRow = {
      document_id: d.id,
      created_at_hint: d.updated_at,
      sha256: h,
      duplicate_of: dupOf,
      duplicate_group_size: h ? groupSize.get(h)! : 1,
      proposed_type: "other",
      extracted_fields: {},
      classification_confidence: 0,
      model_confidence: null,
      proposed_match: null,
      match_confidence: null,
      proposed_action: dupOf ? "dismiss_duplicate" : "review",
      review_required: true,
      reasons: dupOf ? ["duplicate_file"] : [],
      error: h ? null : "file could not be read",
    };
    // Duplicates are not sent to the model at all (saves cost; same bytes).
    if (!dupOf && h && opts.extract) {
      const p = await deps.previewExtract(d);
      if (!p.ok) {
        row.error = p.message;
        row.reasons = ["extraction_failed"];
      } else {
        const decision = await computeDecision(repo, { ...d, extracted_data: p.extracted, extraction_version: "v2" });
        const f = (p.extracted as { fields?: Record<string, unknown> })?.fields ?? {};
        row.proposed_type = documentTypeLabel(decision.type);
        row.extracted_fields = f;
        row.classification_confidence = decision.classification.score;
        row.model_confidence = decision.classification.model_confidence;
        row.proposed_match = decision.match?.target_id ?? null;
        row.match_confidence = decision.match?.score ?? null;
        row.proposed_action = decision.proposed?.kind ?? "review";
        row.reasons = decision.reasons;
        // Backfill policy: EVERY legacy row is human-reviewed, even if the
        // live rules would have routed it automatically.
        row.review_required = true;
      }
    }
    rows.push(row);
  }
  return rows;
}
