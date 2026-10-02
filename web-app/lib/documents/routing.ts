// =============================================================================
//  Document automation — routing decision (pure)
// -----------------------------------------------------------------------------
//  decideRouting() never touches the database. Given a sanitised extraction
//  and the candidate records, it returns a proposal and either "auto" (both
//  scores high, no reason for doubt) or "review" with explicit reasons.
//
//  Hard rules encoded here:
//    * An unmatched rate confirmation NEVER creates a load automatically; it
//      goes to review with a `create_load` proposal a human must confirm.
//    * Any doubt (low score, missing field, ambiguity, mismatch, protected
//      financial record, possible duplicate, prior duplicate file) => review.
// =============================================================================

import {
  AUTO_CLASSIFICATION_MIN,
  AUTO_EXPENSE_MAX,
  AUTO_MATCH_MIN,
  bandOf,
  classificationScore,
  RECEIPT_MAX_AGE_DAYS,
} from "./confidence";
import { sanitizeExtraction, type SanitizedExtraction } from "./extraction";
import {
  addDays,
  findPossibleDuplicateExpense,
  matchDriver,
  matchLoad,
  normalizeIdentifier,
} from "./matching";
import {
  DOCUMENT_TYPE_GROUP,
  DOCUMENT_TYPE_LABELS,
  EXPENSE_CATEGORY_FOR_TYPE,
  routableDocumentType,
  type CanonicalDocumentType,
} from "./taxonomy";
import type {
  DriverCandidate,
  ExpenseSimilar,
  LoadCandidate,
  MatchResult,
  ProposedAction,
  ReviewReason,
  RoutingRecord,
} from "./types";

export interface StoredExtraction extends Partial<SanitizedExtraction> {
  parse_stage?: string;
  type_hint?: string | null;
}

/**
 * Re-sanitise whatever is stored in documents.extracted_data (+ human
 * corrections). JSONB is never trusted, even though the Edge Function
 * already sanitised it.
 */
export function effectiveExtraction(
  stored: unknown,
  corrections?: Record<string, unknown> | null,
): { extraction: SanitizedExtraction; parseFailed: boolean; typeHint: CanonicalDocumentType | null } {
  const s = (stored && typeof stored === "object" ? stored : {}) as StoredExtraction;
  const fields = s.fields && typeof s.fields === "object" ? s.fields : {};
  const raw: Record<string, unknown> = {
    ...fields,
    document_type: s.document_type,
    confidence: s.model_confidence ?? undefined,
    notes: s.notes,
  };
  if (corrections) Object.assign(raw, corrections);
  const hint = s.type_hint ? routableDocumentType(s.type_hint) : null;
  return {
    extraction: sanitizeExtraction(raw),
    parseFailed: s.parse_stage === "fallback" || s.extraction_version !== "v2",
    typeHint: hint && hint !== "other" ? hint : null,
  };
}

export interface DecideInput {
  documentId: string;
  ownerId: string;
  extraction: SanitizedExtraction;
  parseFailed: boolean;
  typeHint: CanonicalDocumentType | null;
  /** Human corrections present => never automatic. */
  humanCorrected: boolean;
  /** Load the user chose at upload (documents.load_id), already ownership-checked. */
  selectedLoad: LoadCandidate | null;
  /** Candidate loads (any owner; filtered again here). */
  loads: readonly LoadCandidate[];
  /** Load ids that are settled / cancelled / paid elsewhere. */
  protectedLoadIds: ReadonlySet<string>;
  drivers: readonly DriverCandidate[];
  /** Human choice in review (validated by the caller). */
  chosenDriverId?: string | null;
  chosenLoadId?: string | null;
  similarExpenses: readonly ExpenseSimilar[];
  duplicateOf: string | null;
  /** YYYY-MM-DD */
  today: string;
}

export type Decision = Pick<
  RoutingRecord,
  "type" | "classification" | "match" | "decision" | "reasons" | "proposed"
>;

const add = (arr: ReviewReason[], r: ReviewReason) => {
  if (!arr.includes(r)) arr.push(r);
};

function loadReasons(m: MatchResult, reasons: ReviewReason[]): void {
  if (m.evidence.includes("no_identifier")) add(reasons, "no_load_identifier");
  else if (m.evidence.includes("not_found")) add(reasons, "load_not_found");
  else if (m.evidence.includes("ambiguous")) add(reasons, "load_ambiguous");
  else if (m.score < AUTO_MATCH_MIN) add(reasons, "load_weak_match");
}

function selectedMatch(load: LoadCandidate): MatchResult {
  return { kind: "load", score: 1, target_id: load.id, candidate_ids: [load.id], evidence: ["selected_by_user"] };
}

export function decideRouting(x: DecideInput): Decision {
  const e = x.extraction;
  const type = e.document_type;
  const f = e.fields as Record<string, unknown>;
  const reasons: ReviewReason[] = [];

  const score = classificationScore({
    type,
    modelConfidence: e.model_confidence,
    missingRequired: e.missing_required,
    parseFailed: x.parseFailed,
    typeHint: x.typeHint,
  });
  if (x.parseFailed) add(reasons, "parse_failed");
  if (type === "other") add(reasons, "unknown_type");
  if (e.missing_required.length > 0) add(reasons, "missing_fields");
  if (x.typeHint && x.typeHint !== type) add(reasons, "type_hint_mismatch");
  if (score < AUTO_CLASSIFICATION_MIN && reasons.length === 0) add(reasons, "low_classification");
  if (x.duplicateOf) add(reasons, "duplicate_file");

  let match: MatchResult | null = null;
  let proposed: ProposedAction | null = null;
  const group = DOCUMENT_TYPE_GROUP[type];
  const chosenLoad = x.chosenLoadId
    ? x.loads.find((l) => l.id === x.chosenLoadId && l.profile_id === x.ownerId) ??
      (x.selectedLoad?.id === x.chosenLoadId ? x.selectedLoad : null)
    : null;

  if (group === "load" || group === "load_paperwork") {
    const ids = [normalizeIdentifier(f.load_number)];
    if (group === "load_paperwork") ids.push(normalizeIdentifier(f.bol_number));
    const auto = matchLoad(x.ownerId, x.loads, {
      identifiers: ids,
      broker_name: group === "load" ? f.broker_name : undefined,
      dates: [f.pickup_date, f.delivery_date],
      cities: [f.origin, f.destination],
    });
    if (chosenLoad) {
      match = selectedMatch(chosenLoad);
    } else if (x.selectedLoad) {
      if (auto.target_id && auto.target_id !== x.selectedLoad.id) {
        add(reasons, "load_conflicts_selection");
        match = auto;
      } else {
        match = selectedMatch(x.selectedLoad);
      }
    } else {
      match = auto;
      loadReasons(auto, reasons);
    }
    const target = match.target_id
      ? (x.loads.find((l) => l.id === match!.target_id) ?? (x.selectedLoad?.id === match.target_id ? x.selectedLoad : null) ?? chosenLoad)
      : null;
    if (type === "rate_confirmation" && target) {
      const docRate = typeof f.total_revenue === "number" ? f.total_revenue : null;
      const loadRate = target.total_revenue === null ? null : Number(target.total_revenue);
      if (docRate !== null && loadRate !== null && loadRate > 0 && Math.abs(docRate - loadRate) > 1) {
        add(reasons, "rate_mismatch");
      }
    }
    if (target) {
      proposed = { kind: "attach_load", load_id: target.id };
    } else if (type === "rate_confirmation") {
      add(reasons, "rate_con_no_load");
      proposed = { kind: "create_load" }; // explicit human action only
    }
  } else if (group === "expense") {
    const category = EXPENSE_CATEGORY_FOR_TYPE[type] ?? "other";
    const amount = typeof f.expense_amount === "number" ? f.expense_amount : null;
    const date = typeof f.receipt_date === "string" ? f.receipt_date : null;
    const vendor = typeof f.vendor_name === "string" ? f.vendor_name : null;
    if (
      amount === null || amount <= 0 || date === null ||
      date > addDays(x.today, 1) || date < addDays(x.today, -RECEIPT_MAX_AGE_DAYS)
    ) {
      add(reasons, "expense_invalid");
    }
    if (amount !== null && amount > (AUTO_EXPENSE_MAX[category] ?? 1000)) {
      add(reasons, "expense_over_auto_limit");
    }

    let loadId: string | null = null;
    if (chosenLoad) {
      match = selectedMatch(chosenLoad);
      loadId = chosenLoad.id;
    } else if (x.selectedLoad) {
      match = selectedMatch(x.selectedLoad);
      loadId = x.selectedLoad.id;
    } else if (normalizeIdentifier(f.load_number)) {
      match = matchLoad(x.ownerId, x.loads, {
        identifiers: [normalizeIdentifier(f.load_number)],
        receipt_date: date,
      });
      loadReasons(match, reasons);
      loadId = match.target_id;
    } // else: company expense with no load printed — no association to doubt.
    if (loadId && x.protectedLoadIds.has(loadId)) add(reasons, "load_protected");

    if (amount !== null && date !== null) {
      const dup = findPossibleDuplicateExpense(
        x.similarExpenses,
        { amount, receipt_date: date, vendor_name: vendor },
        x.documentId,
      );
      if (dup) add(reasons, "expense_possible_duplicate");
      const extras = [
        typeof f.description === "string" ? f.description : null,
        typeof f.unit_number === "string" ? `Unit ${f.unit_number}` : null,
        typeof f.receipt_number === "string" ? `Receipt ${f.receipt_number}` : null,
      ].filter(Boolean);
      proposed = {
        kind: "create_expense",
        expense: {
          category,
          amount,
          vendor_name: vendor,
          receipt_date: date,
          description: extras.length ? extras.join(" · ").slice(0, 500) : null,
          load_id: loadId,
        },
      };
    }
  } else if (group === "driver") {
    const kind = type as "cdl" | "medical_card" | "mvr";
    if (x.chosenDriverId) {
      const d = x.drivers.find((dr) => dr.id === x.chosenDriverId && dr.profile_id === x.ownerId);
      match = d
        ? { kind: "driver", score: 1, target_id: d.id, candidate_ids: [d.id], evidence: ["selected_by_user"] }
        : { kind: "driver", score: 0, target_id: null, candidate_ids: [], evidence: ["not_found"] };
    } else {
      match = matchDriver(x.ownerId, x.drivers, {
        person_name: f.person_name,
        license_number: f.license_number,
        license_state: f.license_state,
      });
    }
    if (match.evidence.includes("conflict")) add(reasons, "driver_conflict");
    else if (match.evidence.includes("ambiguous")) add(reasons, "driver_ambiguous");
    else if (match.evidence.includes("not_found")) add(reasons, "no_driver_match");
    else if (match.score < AUTO_MATCH_MIN) add(reasons, "driver_weak_match");
    if (match.target_id) {
      const driver = x.drivers.find((d) => d.id === match!.target_id);
      const issue = (kind === "mvr" ? f.report_date : f.issue_date ?? f.exam_date) as string | undefined;
      proposed = {
        kind: "attach_driver_document",
        compliance: {
          driver_id: match.target_id,
          document_kind: kind,
          title: `${DOCUMENT_TYPE_LABELS[kind]} — ${driver?.name ?? "driver"}`.slice(0, 200),
          issue_date: typeof issue === "string" ? issue : null,
          expiration_date: kind === "mvr" ? null : (typeof f.expiration_date === "string" ? f.expiration_date : null),
        },
      };
    }
  }

  const matchOk = match === null || match.score >= AUTO_MATCH_MIN;
  const auto = !x.humanCorrected &&
    reasons.length === 0 &&
    score >= AUTO_CLASSIFICATION_MIN &&
    matchOk &&
    proposed !== null &&
    proposed.kind !== "create_load";

  return {
    type,
    classification: {
      score,
      band: bandOf(score),
      model_confidence: e.model_confidence,
      missing_required: e.missing_required,
      rejected_keys: e.rejected_keys,
    },
    match,
    decision: auto ? "auto" : "review",
    reasons: auto ? [] : reasons.length ? reasons : x.humanCorrected ? [] : ["low_classification"],
    proposed,
  };
}
