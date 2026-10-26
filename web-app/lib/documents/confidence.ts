// =============================================================================
//  Document automation — deterministic confidence model
// -----------------------------------------------------------------------------
//  The model's own "high/medium/low" label is ONE input, never the decision.
//  Two independent scores must both clear their bar before anything is
//  changed automatically:
//
//    classification score  (is this really a <type> and are its key fields
//                            readable?)                  >= AUTO_CLASSIFICATION_MIN
//    match score           (is this really load X / driver Y?)
//                                                         >= AUTO_MATCH_MIN
//
//  Thresholds and why:
//    MODEL_SCORE high=0.90 medium=0.60 low=0.30 (missing label = low).
//    Incomplete required fields cap the score at 0.50, a disagreeing upload
//    type hint caps it at 0.50, and type "other" / a failed parse score 0.
//    => only a "high" label with every required field present reaches 0.90,
//       and AUTO_CLASSIFICATION_MIN = 0.85 admits exactly that case.
//
//    Load match: exact, unique normalised load number = 0.70 on its own,
//    + 0.20 broker corroborates, + 0.20 a date corroborates, + 0.10 a
//    city corroborates (capped at 1.0). AUTO_MATCH_MIN = 0.90 therefore
//    REQUIRES the load number plus at least one independent corroboration;
//    a load number alone (0.70) always goes to review. Ambiguous or fuzzy
//    load numbers score 0.
//
//    Driver match: exact, unique normalised full name = 0.60; matching the
//    driver's CDL number on file adds 0.40. Name alone (0.60) never routes
//    automatically; name + license (1.00) does. License pointing at a
//    different driver than the name = conflict = 0.
// =============================================================================

export const MODEL_SCORE = { high: 0.9, medium: 0.6, low: 0.3 } as const;
export const INCOMPLETE_CAP = 0.5;
export const HINT_MISMATCH_CAP = 0.5;

export const AUTO_CLASSIFICATION_MIN = 0.85;
export const AUTO_MATCH_MIN = 0.9;

export const LOAD_MATCH = {
  exactUniqueNumber: 0.7,
  broker: 0.2,
  date: 0.2,
  city: 0.1,
} as const;

export const DRIVER_MATCH = {
  exactUniqueName: 0.6,
  license: 0.4,
} as const;

/** Days of slack when a date corroborates a load (pickup/delivery). */
export const DATE_TOLERANCE_DAYS = 1;
/** Receipt dated within [pickup - N, delivery + N] corroborates a load. */
export const RECEIPT_LOAD_WINDOW_DAYS = 3;

/** Receipts above these totals always go to review (USD). */
export const AUTO_EXPENSE_MAX: Readonly<Record<string, number>> = {
  fuel: 2500,
  lumper: 1000,
  toll: 500,
  maintenance: 5000,
  scale: 150,
};
/** Receipts older than this (days) or dated in the future go to review. */
export const RECEIPT_MAX_AGE_DAYS = 365;

export type ConfidenceBand = "high" | "medium" | "low";

export function bandOf(score: number): ConfidenceBand {
  if (score >= AUTO_CLASSIFICATION_MIN) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export interface ClassificationInput {
  type: string;
  modelConfidence: "high" | "medium" | "low" | null;
  missingRequired: readonly string[];
  parseFailed: boolean;
  /** Canonical type chosen at upload, if any. */
  typeHint: string | null;
}

export function classificationScore(x: ClassificationInput): number {
  if (x.parseFailed || x.type === "other") return 0;
  let s: number = x.modelConfidence ? MODEL_SCORE[x.modelConfidence] : MODEL_SCORE.low;
  if (x.missingRequired.length > 0) s = Math.min(s, INCOMPLETE_CAP);
  if (x.typeHint && x.typeHint !== "other" && x.typeHint !== x.type) {
    s = Math.min(s, HINT_MISMATCH_CAP);
  }
  return Math.round(s * 100) / 100;
}
