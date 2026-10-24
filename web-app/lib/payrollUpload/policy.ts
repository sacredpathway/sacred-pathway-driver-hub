// =============================================================================
//  Smart Payroll Upload — what a document may be used for (pure)
// -----------------------------------------------------------------------------
//  Owner decisions (2026-10-24):
//    * factoring-company and external-carrier settlement statements are
//      REFERENCE-ONLY;
//    * nothing becomes payroll without a human confirming it;
//    * completed payroll (paystubs, finalized settlements) is never changed.
//  Phase 1 goes further and treats EVERY settlement statement and paystub as
//  reference-only: this app is the system of record for its own settlements,
//  so importing its own statements back would duplicate them.
// =============================================================================

import { companiesCorroborate, normalizeIdentifier } from "../documents/matching";
import type { SanitizedPayrollExtraction } from "../documents/payrollExtraction";

export type PayrollUse =
  | "draft_candidate" // may propose a settlement load line (human confirms)
  | "expense_candidate" // receipt -> existing expense/deduction review flow
  | "supporting_document" // BOL/POD: attach to a load / settlement line
  | "reference_only" // shown for comparison; never written to payroll
  | "not_payroll";

export type PolicyReason =
  | "factoring_company_statement"
  | "external_carrier_statement"
  | "own_company_statement"
  | "issuer_unconfirmed"
  | "completed_payroll_record"
  | "external_carrier_rate_confirmation"
  | "carrier_unconfirmed"
  | "parse_incomplete";

export interface OwnCompany {
  names: readonly string[];
  mcNumbers: readonly string[];
}

export interface PolicyResult {
  use: PayrollUse;
  reasons: PolicyReason[];
  /** Always true: there is no automatic path into payroll. */
  requiresHumanReview: true;
}

/** "MC# <digits>", "mc<digits>", "<digits>" -> "<digits>". */
export function mcKey(v: unknown): string | null {
  const n = normalizeIdentifier(v);
  if (!n) return null;
  const s = n.replace(/^MC/, "");
  return s.length >= 3 ? s : null;
}

/** true = ours, false = clearly someone else, null = nothing printed to decide. */
export function isOwnCompany(name: unknown, mc: unknown, own: OwnCompany): boolean | null {
  const m = mcKey(mc);
  if (m && own.mcNumbers.some((x) => mcKey(x) === m)) return true;
  if (typeof name === "string" && name && own.names.some((n) => companiesCorroborate(n, name))) return true;
  if (m || (typeof name === "string" && name)) return false;
  return null;
}

export function payrollUseOf(x: SanitizedPayrollExtraction, own: OwnCompany): PolicyResult {
  const out = (use: PayrollUse, reasons: PolicyReason[]): PolicyResult => ({ use, reasons, requiresHumanReview: true });

  switch (x.document_type) {
    case "settlement_statement": {
      const role = x.issuer?.role ?? "unknown";
      if (role === "factoring_company") return out("reference_only", ["factoring_company_statement"]);
      const ours = isOwnCompany(x.issuer?.name, x.issuer?.mc_number, own);
      if (role === "external_carrier" || role === "broker" || ours === false) {
        return out("reference_only", ["external_carrier_statement"]);
      }
      if (role === "our_company" && ours === true) return out("reference_only", ["own_company_statement"]);
      return out("reference_only", ["issuer_unconfirmed"]);
    }
    case "paystub":
      return out("reference_only", ["completed_payroll_record"]);
    case "rate_confirmation": {
      const carrier = isOwnCompany(x.values.carrier_name, x.values.carrier_mc_number, own);
      if (carrier === false) return out("reference_only", ["external_carrier_rate_confirmation"]);
      const reasons: PolicyReason[] = [];
      if (x.missing_required.length) reasons.push("parse_incomplete");
      if (carrier === null) reasons.push("carrier_unconfirmed");
      return out("draft_candidate", reasons);
    }
    case "bol":
    case "pod":
      return out("supporting_document", []);
    case "fuel_receipt":
    case "lumper_fee":
    case "toll":
    case "repair":
      return out("expense_candidate", []);
    default:
      return out("not_payroll", []);
  }
}
