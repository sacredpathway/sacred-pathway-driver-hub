// =============================================================================
//  Smart Payroll Upload — the signed-in carrier's own identity (pure)
// -----------------------------------------------------------------------------
//  Built ONLY from the carrier's own `profiles` row (company_name, mc_number,
//  dot_number, account_type, account_role). No company name, MC or DOT number
//  is written in this codebase: lib/payrollUpload/noHardcodedIdentity.test.ts
//  fails the build if one appears.
//
//  "verified" means the profile is a carrier account (not a driver portal
//  account) AND it carries at least one business identifier we can match a
//  document against. An unverified identity never blocks reading; it makes
//  the review screen ask the owner to confirm the carrier on the document.
// =============================================================================

import { companyTokens, normalizeIdentifier } from "../documents/matching";
import { mcKey, type OwnCompany } from "./policy";

export interface CarrierProfileRow {
  id: string;
  company_name: string | null;
  mc_number: string | null;
  dot_number: string | null;
  account_type: string | null;
  account_role: string | null;
}

export type IdentityReason =
  | "driver_account"
  | "no_company_name"
  | "no_mc_number"
  | "no_identifiers"
  | "mc_number_unreadable";

export interface CarrierIdentity extends OwnCompany {
  profileId: string;
  verified: boolean;
  dotNumbers: readonly string[];
  reasons: IdentityReason[];
  /** For display only. */
  displayName: string | null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length ? s.slice(0, 200) : null;
};

/** "USDOT <digits>", "DOT#<digits>" -> "<digits>". */
export function dotKey(v: unknown): string | null {
  const n = normalizeIdentifier(v);
  if (!n) return null;
  const s = n.replace(/^(US)?DOT/, "");
  return /^\d{3,10}$/.test(s) ? s : null;
}

export function carrierIdentityFromProfile(p: CarrierProfileRow | null): CarrierIdentity | null {
  if (!p || typeof p.id !== "string") return null;
  const reasons: IdentityReason[] = [];
  const name = clean(p.company_name);
  const mcRaw = clean(p.mc_number);
  const mc = mcRaw ? mcKey(mcRaw) : null;
  const dot = dotKey(p.dot_number);

  if ((p.account_type ?? "").toLowerCase() === "driver") reasons.push("driver_account");
  if (!name) reasons.push("no_company_name");
  if (!mcRaw) reasons.push("no_mc_number");
  else if (!mc) reasons.push("mc_number_unreadable");
  const usableName = name !== null && companyTokens(name).length > 0;
  if (!usableName && !mc && !dot) reasons.push("no_identifiers");

  return {
    profileId: p.id,
    names: usableName ? [name!] : [],
    mcNumbers: mc ? [mc] : [],
    dotNumbers: dot ? [dot] : [],
    verified: !reasons.includes("driver_account") && !reasons.includes("no_identifiers"),
    reasons,
    displayName: name,
  };
}

/** Owner-only gate (staff roles are deferred by owner decision). */
export function isCarrierOwnerAccount(p: Pick<CarrierProfileRow, "account_type" | "account_role"> | null): boolean {
  if (!p) return false;
  const type = (p.account_type ?? "").toLowerCase();
  const role = (p.account_role ?? "").toLowerCase();
  if (type === "driver") return false;
  // NULL = every pre-existing carrier row; "carrier" = explicit carrier.
  return role === "" || role === "carrier";
}
