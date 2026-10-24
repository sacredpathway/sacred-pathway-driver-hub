// =============================================================================
//  Smart Payroll Upload — confirmation gate (pure)
// -----------------------------------------------------------------------------
//  The review screen is read-only everywhere. The "Confirm to draft" write
//  path is OFF unless BOTH are true:
//    1. SMART_PAYROLL_CONFIRM === "local-only"
//    2. the Supabase URL points at this machine (127.0.0.1 / localhost)
//  Production (https://<ref>.supabase.co) can never satisfy (2), so setting
//  the variable there by mistake still leaves confirmation disabled. Turning
//  it on for staging later is a deliberate code change, not a config flip.
// =============================================================================

export type GateReason = "flag_off" | "not_local_database" | "missing_database_url" | "enabled_local_only";

export interface ConfirmGate {
  enabled: boolean;
  reason: GateReason;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function payrollConfirmGate(env: Readonly<Record<string, string | undefined>>): ConfirmGate {
  if (env.SMART_PAYROLL_CONFIRM !== "local-only") return { enabled: false, reason: "flag_off" };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url) return { enabled: false, reason: "missing_database_url" };
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { enabled: false, reason: "missing_database_url" };
  }
  if (!LOCAL_HOSTS.has(host)) return { enabled: false, reason: "not_local_database" };
  return { enabled: true, reason: "enabled_local_only" };
}

export const GATE_MESSAGE: Record<GateReason, string> = {
  flag_off: "Confirming payroll drafts from documents is turned off in this environment. You can review everything; nothing will be saved.",
  not_local_database: "Confirming payroll drafts from documents only runs against a local test database. Nothing will be saved here.",
  missing_database_url: "Confirming payroll drafts is unavailable: no database is configured.",
  enabled_local_only: "Local test mode: confirming creates a DRAFT in the local test database only.",
};
