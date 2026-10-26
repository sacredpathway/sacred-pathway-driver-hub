// =============================================================================
//  Load status vocabulary — web twin of iOS `LoadStatusVocabulary`
// -----------------------------------------------------------------------------
//  `loads.status` is free text shared with iOS and older builds. This module
//  names every stored value known to exist, gives each one label/group/
//  settlement semantics, and decides which values the web may WRITE.
//
//  No database enum. No production rewrite. Unknown values are displayed,
//  never dropped.
// =============================================================================

export const KNOWN_LOAD_STATUSES = [
  "pending",
  "active",
  "unassigned",
  "assigned",
  "dispatched",
  "picked_up",
  "in_transit",
  "delivered",
  "completed",
  "ready_for_settlement",
  "settled",
  "cancelled",
] as const;

export type KnownLoadStatus = (typeof KNOWN_LOAD_STATUSES)[number];

export type LoadStatusGroup = "open" | "completed" | "settled" | "cancelled" | "unknown";

/** How iOS settlement eligibility (SettlementWorkflowService.isCompleted) treats a status. */
export type SettlementEligibility =
  | "never"               // cancelled — financial boundary, no exceptions
  | "completed"           // ready_for_settlement / settled
  | "after_delivery_date"; // everything else: eligible once delivery_date <= today

const LABELS: Record<KnownLoadStatus, string> = {
  pending: "Unassigned",
  active: "Active",
  unassigned: "Unassigned",
  assigned: "Assigned",
  dispatched: "Dispatched",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  delivered: "Delivered",
  completed: "Completed",
  ready_for_settlement: "Ready for Settlement",
  settled: "Settled",
  cancelled: "Cancelled",
};

const GROUPS: Record<KnownLoadStatus, LoadStatusGroup> = {
  pending: "open",
  active: "open",
  unassigned: "open",
  assigned: "open",
  dispatched: "open",
  picked_up: "open",
  in_transit: "open",
  delivered: "completed",
  completed: "completed",
  ready_for_settlement: "completed",
  settled: "settled",
  cancelled: "cancelled",
};

/**
 * Statuses the web may newly WRITE (create / change to).
 *
 * COMPATIBILITY GATE (Phase 0.5, 2026-09-30): `cancelled` is deliberately
 * absent. Until the iOS build containing the cancelled-settlement fix
 * (LoadStatusVocabulary + SettlementWorkflowService.isCompleted) is live and
 * adopted, a web-written `cancelled` could still reach settlement on older
 * iOS builds. `dispatched`, `picked_up`, `completed`, `pending`, `active`
 * are read/display-only for the same reason.
 * TODO(status-gate): re-add "cancelled" (and the extra lifecycle states) once
 * docs/phase0/LOAD_STATUS_COMPATIBILITY.md is marked resolved.
 */
export const WRITABLE_LOAD_STATUSES = [
  "unassigned",
  "assigned",
  "in_transit",
  "delivered",
  "ready_for_settlement",
  "settled",
] as const satisfies ReadonlyArray<KnownLoadStatus>;

export type WritableLoadStatus = (typeof WRITABLE_LOAD_STATUSES)[number];

/** Trimmed, lower-cased; "canceled" folds into "cancelled". Empty → null. */
export function normalizeLoadStatus(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return v === "canceled" ? "cancelled" : v;
}

export function isKnownLoadStatus(raw: string | null | undefined): raw is KnownLoadStatus {
  const v = normalizeLoadStatus(raw);
  return v !== null && (KNOWN_LOAD_STATUSES as ReadonlyArray<string>).includes(v);
}

/** Human label for a stored value. Empty → "—". Unknown → "Title Case". */
export function loadStatusLabel(raw: string | null | undefined): string {
  const v = normalizeLoadStatus(raw);
  if (!v) return "—";
  if (isKnownLoadStatus(v)) return LABELS[v as KnownLoadStatus];
  return v
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function loadStatusGroup(raw: string | null | undefined): LoadStatusGroup {
  const v = normalizeLoadStatus(raw);
  if (!v) return "open";
  return isKnownLoadStatus(v) ? GROUPS[v as KnownLoadStatus] : "unknown";
}

export function isCancelledStatus(raw: string | null | undefined): boolean {
  return normalizeLoadStatus(raw) === "cancelled";
}

export function settlementEligibility(raw: string | null | undefined): SettlementEligibility {
  const v = normalizeLoadStatus(raw);
  if (v === "cancelled") return "never";
  if (v === "ready_for_settlement" || v === "settled") return "completed";
  return "after_delivery_date";
}

export function isWritableLoadStatus(raw: string | null | undefined): raw is WritableLoadStatus {
  const v = normalizeLoadStatus(raw);
  return v !== null && (WRITABLE_LOAD_STATUSES as ReadonlyArray<string>).includes(v);
}

/**
 * May a form submit `next` for a load whose stored status is `current`?
 * - writable values: always
 * - empty: allowed (clears the status, existing edit-form behaviour)
 * - any other value: only when it is UNCHANGED, so editing a legacy
 *   `pending` / `cancelled` load never forces a status change — but nothing
 *   can newly become `cancelled`.
 */
export function isAllowedStatusWrite(
  next: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const n = normalizeLoadStatus(next);
  if (n === null) return true;
  if (isWritableLoadStatus(n)) return true;
  return n === normalizeLoadStatus(current);
}

export interface StatusOption {
  value: string;
  label: string;
}

/**
 * Options for a status <select>. Writable statuses only — plus the load's
 * CURRENT stored value when it isn't writable, labelled "(current)", so the
 * form shows the truth and saving without touching it keeps it.
 */
export function statusOptionsFor(
  current: string | null | undefined,
  { includeEmpty = false }: { includeEmpty?: boolean } = {},
): StatusOption[] {
  const opts: StatusOption[] = [];
  if (includeEmpty) opts.push({ value: "", label: "— Not set —" });
  for (const s of WRITABLE_LOAD_STATUSES) opts.push({ value: s, label: LABELS[s] });
  const raw = (current ?? "").trim();
  if (raw && !isWritableLoadStatus(raw)) {
    opts.push({ value: raw, label: `${loadStatusLabel(raw)} (current)` });
  }
  return opts;
}

// -----------------------------------------------------------------------------
//  Visual tone (Phase A) — the ONE mapping from stored status to badge colour.
//  Display-only: it never changes what may be written (see
//  WRITABLE_LOAD_STATUSES / isAllowedStatusWrite above).
// -----------------------------------------------------------------------------

export type LoadStatusTone =
  | "neutral"   // unassigned / pending / not set
  | "info"      // assigned / active / dispatched
  | "progress"  // picked_up / in_transit
  | "success"   // delivered / completed
  | "gold"      // ready_for_settlement
  | "settled"   // settled
  | "danger"    // cancelled
  | "unknown";  // a value this build doesn't know

const TONES: Record<KnownLoadStatus, LoadStatusTone> = {
  pending: "neutral",
  unassigned: "neutral",
  active: "info",
  assigned: "info",
  dispatched: "info",
  picked_up: "progress",
  in_transit: "progress",
  delivered: "success",
  completed: "success",
  ready_for_settlement: "gold",
  settled: "settled",
  cancelled: "danger",
};

export function loadStatusTone(raw: string | null | undefined): LoadStatusTone {
  const v = normalizeLoadStatus(raw);
  if (!v) return "neutral";
  return isKnownLoadStatus(v) ? TONES[v as KnownLoadStatus] : "unknown";
}

// -----------------------------------------------------------------------------
//  New Load status (owner rule, 2026-09-30): "entered load = delivered load".
// -----------------------------------------------------------------------------
//  A load created from the web New Load form is documented from its paperwork,
//  i.e. it is already delivered. The form no longer asks for a status; the
//  server always writes this EXISTING value — no new status is introduced.
//
//  Why `ready_for_settlement` (not `delivered`):
//    • iOS `LoadStatus` (every shipped build) parses it as `.readyForSettlement`
//      and `SettlementWorkflowService.isCompleted` returns true immediately,
//      so the load is settlement/driver-pay eligible right away.
//    • `delivered` is not an iOS enum case: iOS falls back to assigned/
//      unassigned and only treats it as complete once delivery_date <= today
//      (never, if the date is blank) — and older builds label it "Assigned".
//    • It is web-writable (passes the Phase 0.5 compatibility gate).
//    • settlementEligibility() === "completed"; not "settled", so pay has not
//      been issued yet and it still shows in paystub/settlement pickers.
// -----------------------------------------------------------------------------

export const NEW_LOAD_STATUS = "ready_for_settlement" as const satisfies WritableLoadStatus;
