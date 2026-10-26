// =============================================================================
//  Document automation — shared types (web)
// -----------------------------------------------------------------------------
//  `documents.routing` (JSONB) is the authoritative audit + undo record for a
//  document: what the extractor produced, how it was scored, what was
//  proposed, what was applied (with before/after snapshots) and every human /
//  automatic event. activity_log gets a best-effort feed copy.
// =============================================================================

import type { CanonicalDocumentType } from "./taxonomy";

export type ReviewStatus = "needs_review" | "auto_routed" | "approved" | "dismissed";

export type ReviewReason =
  | "extraction_failed"
  | "parse_failed"
  | "unknown_type"
  | "legacy_type"
  | "low_classification"
  | "missing_fields"
  | "type_hint_mismatch"
  | "duplicate_file"
  | "no_load_identifier"
  | "load_not_found"
  | "load_ambiguous"
  | "load_weak_match"
  | "load_conflicts_selection"
  | "rate_mismatch"
  | "rate_con_no_load"
  | "load_protected"
  | "no_driver_match"
  | "driver_ambiguous"
  | "driver_weak_match"
  | "driver_conflict"
  | "expense_invalid"
  | "expense_over_auto_limit"
  | "expense_possible_duplicate"
  | "already_applied"
  | "apply_failed"
  | "undone";

export const REVIEW_REASON_TEXT: Readonly<Record<ReviewReason, string>> = {
  extraction_failed: "The AI could not read this file.",
  parse_failed: "The AI response could not be understood.",
  unknown_type: "Document type not recognised.",
  legacy_type: "This document type is not routed automatically.",
  low_classification: "The AI is not confident about this document.",
  missing_fields: "Key fields could not be read.",
  type_hint_mismatch: "The AI's type disagrees with the type chosen at upload.",
  duplicate_file: "Same file was uploaded before.",
  no_load_identifier: "No load number found on the document.",
  load_not_found: "No load in your account has this load number.",
  load_ambiguous: "More than one load has this load number.",
  load_weak_match: "Load number matched but nothing else confirms it.",
  load_conflicts_selection: "The document points to a different load than the one selected at upload.",
  rate_mismatch: "Rate on the document differs from the load's total.",
  rate_con_no_load: "No matching load — create one only if this load is real.",
  load_protected: "The load is settled, cancelled or already paid.",
  no_driver_match: "No driver on your roster matches this name.",
  driver_ambiguous: "More than one driver could match.",
  driver_weak_match: "Name matched but the license number could not confirm it.",
  driver_conflict: "Name and license number point to different drivers.",
  expense_invalid: "Amount or date is missing or out of range.",
  expense_over_auto_limit: "Amount is above the automatic limit.",
  expense_possible_duplicate: "A matching expense already exists.",
  already_applied: "This document was already routed.",
  apply_failed: "Routing failed; nothing was changed.",
  undone: "An automatic action was undone.",
};

export interface ExpenseDraft {
  category: string;
  amount: number;
  vendor_name: string | null;
  receipt_date: string;
  description: string | null;
  load_id: string | null;
}

export interface ComplianceDraft {
  driver_id: string;
  document_kind: "cdl" | "medical_card" | "mvr";
  title: string;
  issue_date: string | null;
  expiration_date: string | null;
}

export type ProposedAction =
  | { kind: "attach_load"; load_id: string }
  | { kind: "create_expense"; expense: ExpenseDraft }
  | { kind: "attach_driver_document"; compliance: ComplianceDraft }
  | { kind: "create_load" };

export type ActionMode = "automatic" | "human_approved";

export interface AppliedAction {
  kind: "attach_load" | "create_expense" | "attach_driver_document" | "create_load";
  target_table: "documents" | "expenses" | "compliance_documents" | "loads";
  target_id: string;
  mode: ActionMode;
  applied_at: string;
  /** Snapshot of the affected record's relevant fields before / after. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  undone_at?: string;
}

export interface MatchResult {
  kind: "load" | "driver" | "none";
  score: number;
  target_id: string | null;
  candidate_ids: string[];
  evidence: string[];
}

export interface RoutingEvent {
  at: string;
  by: "automation" | "user";
  event: string;
  detail?: string;
}

export interface RoutingRecord {
  version: 1;
  decided_at: string;
  type: CanonicalDocumentType;
  classification: {
    score: number;
    band: "high" | "medium" | "low";
    model_confidence: "high" | "medium" | "low" | null;
    missing_required: string[];
    rejected_keys: string[];
  };
  match: MatchResult | null;
  decision: "auto" | "review";
  reasons: ReviewReason[];
  proposed: ProposedAction | null;
  applied: AppliedAction[];
  /** Human corrections layered over the (immutable) AI extraction. */
  corrections?: Record<string, string | number | boolean>;
  history: RoutingEvent[];
}

/** Columns the automation reads from `documents`. */
export interface AutomationDocument {
  id: string;
  profile_id: string;
  load_id: string | null;
  document_type: string | null;
  storage_path: string;
  status: string;
  extracted_data: unknown;
  extraction_version: string | null;
  review_status: ReviewStatus | null;
  routing: RoutingRecord | null;
  duplicate_of: string | null;
  content_sha256: string | null;
  source: string | null;
  updated_at: string | null;
  error_message: string | null;
  /** Settlement (draft or finalized) this document was confirmed onto, if any. */
  settlement_id?: string | null;
}

export interface LoadCandidate {
  id: string;
  profile_id: string;
  load_number: string | null;
  broker_name: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  origin: string | null;
  destination: string | null;
  total_revenue: number | null;
  status: string | null;
}

export interface DriverCandidate {
  id: string;
  profile_id: string;
  name: string;
  cdl_number: string | null;
  cdl_state: string | null;
  active: boolean | null;
}

export interface ExpenseSimilar {
  id: string;
  amount: number;
  receipt_date: string | null;
  vendor_name: string | null;
  source_document_id: string | null;
}
