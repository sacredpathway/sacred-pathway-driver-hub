// =============================================================================
//  Paystub payment integrity — web side of migration
//  supabase/migrations/20261001120000_paystub_payment_integrity.sql
// -----------------------------------------------------------------------------
//  The database is authoritative:
//    • issue_paystub(p_paystub_id)  draft → issued + every load → settled (atomic)
//    • void_paystub(p_paystub_id)   issued/paid → voided + safe load release (atomic)
//    • triggers                     block paying a load already paid elsewhere,
//                                   editing load lines off-draft, and invalid
//                                   status transitions
//  This module only turns the database's reason codes into carrier-facing
//  messages. It never decides eligibility itself.
// =============================================================================

export const ISSUE_PAYSTUB_RPC = "issue_paystub" as const;
export const VOID_PAYSTUB_RPC = "void_paystub" as const;
export const LOAD_CONFLICTS_RPC = "sph_loads_payment_conflicts" as const;

export const INTEGRITY_CODES = [
  "load_not_found",
  "load_cancelled",
  "load_settled",
  "load_on_issued_paystub",
  "load_on_settlement",
  "paystub_locked",
  "paystub_not_found",
  "paystub_not_draft",
  "paystub_not_voidable",
  "paystub_invalid_transition",
  "not_authenticated",
] as const;

export type IntegrityCode = (typeof INTEGRITY_CODES)[number];

const MESSAGES: Record<IntegrityCode, string> = {
  load_not_found: "Load not found or not in your account.",
  load_cancelled: "Cancelled loads can't be paid.",
  load_settled: "This load is already settled — it was paid on another paystub or settlement.",
  load_on_issued_paystub: "This load is already on an issued or paid paystub.",
  load_on_settlement: "This load is already on an approved or paid settlement in the iPhone app.",
  paystub_locked: "Paystub is locked — only drafts can be edited.",
  paystub_not_found: "Paystub not found.",
  paystub_not_draft: "Only draft paystubs can be issued.",
  paystub_not_voidable: "Only issued or paid paystubs can be voided.",
  paystub_invalid_transition: "That status change isn't allowed for this paystub.",
  not_authenticated: "Not signed in.",
};

/** Shown when the database functions are missing (migration not applied yet). */
export const INTEGRITY_UNAVAILABLE =
  "Paystub issuing is unavailable until the database update is applied. Nothing was changed.";

type DbError = { message?: string | null; code?: string | null; details?: string | null } | null | undefined;

/** Reason code at the start of a database error message, if any. */
export function integrityCode(err: DbError): IntegrityCode | null {
  const msg = (err?.message ?? "").trim();
  for (const code of INTEGRITY_CODES) {
    if (msg === code || msg.startsWith(`${code}:`) || msg.startsWith(`${code} `)) return code;
  }
  return null;
}

/** True when PostgREST can't find the RPC (migration not applied). */
export function isMissingFunction(err: DbError): boolean {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  return code === "PGRST202" || code === "42883" || /could not find the function/i.test(msg);
}

/** Carrier-facing message for a database error; falls back to the raw text. */
export function integrityMessage(err: DbError, loadLabel?: string | null): string {
  if (isMissingFunction(err)) return INTEGRITY_UNAVAILABLE;
  const code = integrityCode(err);
  if (!code) return err?.message ?? "Something went wrong.";
  const base = MESSAGES[code];
  return loadLabel && code.startsWith("load_") ? `${loadLabel}: ${base}` : base;
}

/** Message for one row returned by sph_loads_payment_conflicts. */
export function conflictMessage(conflict: string, loadLabel?: string | null): string {
  return integrityMessage({ message: conflict }, loadLabel);
}
