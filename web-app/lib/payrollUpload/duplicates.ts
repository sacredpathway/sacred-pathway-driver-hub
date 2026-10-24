// =============================================================================
//  Smart Payroll Upload — duplicate detection (pure, read-only)
// -----------------------------------------------------------------------------
//  Three layers:
//    1. same FILE      : SHA-256 of the original bytes, per carrier account;
//    2. same DOCUMENT  : normalized identity (type + printed identifiers);
//    3. same PAYROLL LINE: the load is already on a settlement / paystub.
//  Nothing here writes. Existing production rows are only read and compared;
//  rows from other accounts are ignored, never reported.
// =============================================================================

import { companyTokens, normalizeIdentifier, normalizePersonName } from "../documents/matching";
import type { PayrollDocumentType } from "../documents/payrollExtraction";

/** Lowercase hex SHA-256 (WebCrypto: Node 20+, browsers, Deno). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isSha256Hex = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

const centsKey = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 100)) : null);
const company = (v: unknown) => {
  const t = companyTokens(v);
  return t.length ? [...t].sort().join("-") : null;
};
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Stable key for "the same document" across different files (re-scans,
 * re-exports). Returns null when the printed identifiers are not enough —
 * it never builds a key from weak data.
 */
export function documentIdentity(
  type: PayrollDocumentType,
  values: Readonly<Record<string, unknown>>,
  issuerName?: string | null,
): string | null {
  const id = (k: string) => normalizeIdentifier(values[k]);
  switch (type) {
    case "rate_confirmation": {
      const load = id("load_number");
      const broker = company(values.broker_name) ?? id("broker_mc_number");
      return load && broker ? `rc|${load}|${broker}` : null;
    }
    case "bol":
    case "pod": {
      const n = id("bol_number") ?? id("load_number");
      return n ? `${type}|${n}` : null;
    }
    case "settlement_statement": {
      const issuer = company(issuerName) ?? id("carrier_mc_number");
      const n = id("statement_number");
      if (issuer && n) return `st|${issuer}|${n}`;
      const end = ymd(values.period_end);
      const net = centsKey(values.net_amount);
      return issuer && end && net ? `st|${issuer}|${end}|${net}` : null;
    }
    case "paystub": {
      const who = normalizePersonName(values.employee_name);
      const end = ymd(values.period_end) ?? ymd(values.check_date);
      const net = centsKey(values.net_pay);
      return who && end && net ? `ps|${who.replace(/\s/g, "-")}|${end}|${net}` : null;
    }
    case "fuel_receipt":
    case "lumper_fee":
    case "toll":
    case "repair": {
      const vendor = company(values.vendor_name);
      const no = id("receipt_number");
      if (vendor && no) return `rcpt|${type}|${vendor}|${no}`;
      const date = ymd(values.receipt_date);
      const amt = centsKey(values.expense_amount);
      return vendor && date && amt ? `rcpt|${type}|${vendor}|${date}|${amt}` : null;
    }
    default:
      return null;
  }
}

export interface ExistingDocument {
  id: string;
  profile_id: string;
  content_sha256: string | null;
  document_identity: string | null;
  review_status: string | null;
  duplicate_of: string | null;
}

export interface DuplicateReport {
  verdict: "new" | "exact_duplicate" | "possible_duplicate";
  /** Same bytes, same account: the root original(s) to point `duplicate_of` at. */
  exactFileIds: string[];
  /** Same identity (different file), same account. */
  sameIdentityIds: string[];
  /** Matches that were already dismissed (still reported, flagged). */
  dismissedIds: string[];
}

export function detectDuplicates(
  candidate: { profileId: string; sha256: string | null; identity: string | null; excludeId?: string },
  existing: readonly ExistingDocument[],
): DuplicateReport {
  const mine = existing.filter((d) => d.profile_id === candidate.profileId && d.id !== candidate.excludeId);
  const exact = isSha256Hex(candidate.sha256) ? mine.filter((d) => d.content_sha256 === candidate.sha256) : [];
  const exactIds = new Set(exact.map((d) => d.id));
  const ident = candidate.identity ? mine.filter((d) => d.document_identity === candidate.identity && !exactIds.has(d.id)) : [];
  const dismissed = [...exact, ...ident].filter((d) => d.review_status === "dismissed").map((d) => d.id);
  const roots = [...new Set(exact.map((d) => d.duplicate_of ?? d.id))];
  return {
    verdict: exact.length ? "exact_duplicate" : ident.length ? "possible_duplicate" : "new",
    exactFileIds: roots,
    sameIdentityIds: ident.map((d) => d.id),
    dismissedIds: dismissed,
  };
}

// ---- layer 3: payroll line -------------------------------------------------

export interface PayrollLineRow {
  settlement_id: string;
  load_id: string | null;
  is_adjustment: boolean;
  settlement_status: string | null;
  is_estimate: boolean | null;
}

export type LoadPayrollState =
  | { state: "free" }
  | { state: "on_draft"; settlementIds: string[] } // warn: already on a draft
  | { state: "finalized"; settlementIds: string[] } // block: approved/paid
  | { state: "paid_by_paystub" } // block: legacy paystub paid it
  | { state: "protected_status"; status: string }; // block: settled/cancelled

const FINAL = new Set(["approved", "paid"]);

export function loadPayrollState(
  loadId: string,
  loadStatus: string | null,
  lines: readonly PayrollLineRow[],
  paystubPaidLoadIds: ReadonlySet<string>,
): LoadPayrollState {
  const on = lines.filter((l) => l.load_id === loadId && !l.is_adjustment && !l.is_estimate && (l.settlement_status ?? "draft") !== "voided");
  const fin = on.filter((l) => FINAL.has(l.settlement_status ?? ""));
  if (fin.length) return { state: "finalized", settlementIds: [...new Set(fin.map((l) => l.settlement_id))] };
  if (paystubPaidLoadIds.has(loadId)) return { state: "paid_by_paystub" };
  const st = (loadStatus ?? "").trim().toLowerCase();
  if (st === "cancelled" || st === "canceled" || st === "settled") return { state: "protected_status", status: st };
  if (on.length) return { state: "on_draft", settlementIds: [...new Set(on.map((l) => l.settlement_id))] };
  return { state: "free" };
}

export const blocksPayroll = (s: LoadPayrollState) =>
  s.state === "finalized" || s.state === "paid_by_paystub" || s.state === "protected_status";
