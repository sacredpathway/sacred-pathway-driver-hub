// =============================================================================
//  Smart Payroll Upload — confirmation gate (pure)
// -----------------------------------------------------------------------------
//  The review screen is read-only everywhere. The "Confirm to draft" write
//  path is OFF unless ONE of these exact pairs is true:
//    1. SMART_PAYROLL_CONFIRM === "local-only"
//       AND the Supabase URL points at this machine (127.0.0.1 / localhost)
//    2. SMART_PAYROLL_CONFIRM === "staging-only"
//       AND the Supabase URL is exactly https://<STAGING_PROJECT_REF>.supabase.co
//       (the synthetic-data staging project; hard-coded on purpose)
//    3. SMART_PAYROLL_CONFIRM === "production"
//       AND SMART_PAYROLL_PRODUCTION_ACK === the production project ref
//       AND the Supabase URL is exactly https://<PRODUCTION_PROJECT_REF>.supabase.co
//       (two separate variables must agree with the URL: a single stray
//       setting can never switch the live system on)
//  The local / staging modes refuse the production URL explicitly, so
//  setting either of them there by mistake still leaves confirmation off.
//
//  The same gate drives AUTOMATIC drafting (lib/autopay): drafts are created
//  without a click only when this gate is on and SMART_PAYROLL_AUTO is not
//  "off". Nothing in either path can approve or pay a settlement.
// =============================================================================

export type GateReason =
  | "flag_off"
  | "not_local_database"
  | "not_staging_database"
  | "production_database"
  | "missing_database_url"
  | "enabled_local_only"
  | "enabled_staging_only"
  | "production_not_acknowledged"
  | "enabled_production";

export interface ConfirmGate {
  enabled: boolean;
  reason: GateReason;
}

/** Synthetic-data staging project (sph-settlements-staging). */
export const STAGING_PROJECT_REF = "aatkirzwuuegurdlmcpl";
/** Production project: never enabled by this gate. */
export const PRODUCTION_PROJECT_REF = "rmzqxsfhjqrshhdjzhze";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function payrollConfirmGate(env: Readonly<Record<string, string | undefined>>): ConfirmGate {
  const mode = env.SMART_PAYROLL_CONFIRM;
  if (mode !== "local-only" && mode !== "staging-only" && mode !== "production") return { enabled: false, reason: "flag_off" };
  const raw = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!raw) return { enabled: false, reason: "missing_database_url" };
  const url = parse(raw);
  if (!url) return { enabled: false, reason: "missing_database_url" };
  const host = url.hostname.toLowerCase();
  if (mode === "production") {
    const exact = url.protocol === "https:" && host === `${PRODUCTION_PROJECT_REF}.supabase.co` && url.port === "" &&
      url.username === "" && url.password === "";
    if (!exact) return { enabled: false, reason: "production_not_acknowledged" };
    if ((env.SMART_PAYROLL_PRODUCTION_ACK ?? "") !== PRODUCTION_PROJECT_REF) return { enabled: false, reason: "production_not_acknowledged" };
    return { enabled: true, reason: "enabled_production" };
  }
  if (host === `${PRODUCTION_PROJECT_REF}.supabase.co` || host.includes(PRODUCTION_PROJECT_REF)) {
    return { enabled: false, reason: "production_database" };
  }
  if (mode === "local-only") {
    if (!LOCAL_HOSTS.has(host)) return { enabled: false, reason: "not_local_database" };
    return { enabled: true, reason: "enabled_local_only" };
  }
  // staging-only: exact https origin of the staging project, nothing else.
  if (url.protocol !== "https:" || host !== `${STAGING_PROJECT_REF}.supabase.co` || url.port !== "" ||
      url.username !== "" || url.password !== "") {
    return { enabled: false, reason: "not_staging_database" };
  }
  return { enabled: true, reason: "enabled_staging_only" };
}

export const GATE_MESSAGE: Record<GateReason, string> = {
  flag_off: "Confirming payroll drafts from documents is turned off in this environment. You can review everything; nothing will be saved.",
  not_local_database: "Confirming payroll drafts from documents only runs against a local test database. Nothing will be saved here.",
  not_staging_database: "Confirming payroll drafts from documents only runs against the staging test project. Nothing will be saved here.",
  production_database: "Confirming payroll drafts from documents is not enabled for the live system yet. You can review everything; nothing will be saved.",
  missing_database_url: "Confirming payroll drafts is unavailable: no database is configured.",
  enabled_local_only: "Local test mode: confirming creates a DRAFT in the local test database only.",
  enabled_staging_only: "Staging test mode: confirming creates a DRAFT in the staging test project only (synthetic data).",
  production_not_acknowledged: "Confirming payroll drafts from documents is not enabled for the live system. You can review everything; nothing will be saved.",
  enabled_production: "Confirming creates a settlement DRAFT. Nothing is approved or paid until you do it on the settlement.",
};
