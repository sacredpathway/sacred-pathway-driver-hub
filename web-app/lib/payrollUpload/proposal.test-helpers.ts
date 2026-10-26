// SYNTHETIC fixtures for proposal / confirm tests. Invented names and numbers only.
import { sanitizePayrollExtraction } from "../documents/payrollExtraction";
import type { ProposalDocument, ProposalInput, ProposalLoad, DraftSettlementRef } from "./proposal";
import { carrierIdentityFromProfile, type CarrierProfileRow } from "./carrierIdentity";
import * as fx from "./fixtures";

export const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
export const OTHER = "bbbbbbbb-0000-4000-8000-000000000001";
export const DRIVER = "aaaaaaaa-0000-4000-8000-00000000d001";
export const DRIVER2 = "aaaaaaaa-0000-4000-8000-00000000d002";
export const LOAD = "aaaaaaaa-0000-4000-8000-0000000a0045";
export const DOC = "dddddddd-0000-4000-8000-000000000001";
export const DRAFT = "5e000000-0000-4000-8000-000000000001";
export const TODAY = "2026-10-24";

export const PROFILE: CarrierProfileRow = { id: OWNER, company_name: "Synthetic Haul LLC", mc_number: "MC 900001", dot_number: "USDOT 7000001", account_type: null, account_role: null };

export function doc(raw: unknown = fx.RATE_CON_OK, over: Partial<ProposalDocument> = {}): ProposalDocument {
  return {
    id: DOC, profile_id: OWNER, status: "processed", document_type: "rate_confirmation", extraction_version: "v3",
    extracted_data: { ...sanitizePayrollExtraction(raw), parse_stage: "strict", type_hint: null },
    content_sha256: "c".repeat(64), review_status: "needs_review", duplicate_of: null, settlement_id: null, routing: null,
    ...over,
  };
}

export function load(over: Partial<ProposalLoad> = {}): ProposalLoad {
  return {
    id: LOAD, profile_id: OWNER, driver_id: DRIVER, load_number: "SYN-10045", broker_name: "Example Brokerage Inc", broker_mc_number: "800123",
    pickup_date: "2026-10-12", delivery_date: "2026-10-13", origin: "Dallas, TX", destination: "Houston, TX",
    total_miles: 240, empty_miles: 0, line_haul_rate: 2200, fuel_surcharge: 200, accessorial_charges: 50, total_revenue: 2450,
    status: "ready_for_settlement", ...over,
  };
}

export function draft(over: Partial<DraftSettlementRef> = {}): DraftSettlementRef {
  return {
    id: DRAFT, profile_id: OWNER, driver_id: DRIVER, period_start: "2026-10-12", period_end: "2026-10-18",
    status: "draft", updated_at: "2026-10-20T10:00:00.123456+00:00", settlement_number: "SP-2026-0042", is_estimate: false, ...over,
  };
}

export function input(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    ownerId: OWNER, today: TODAY, document: doc(), identity: carrierIdentityFromProfile(PROFILE),
    loads: [load()],
    drivers: [
      { id: DRIVER, profile_id: OWNER, name: "Test Driver One", cdl_number: null, cdl_state: null, active: true },
      { id: DRIVER2, profile_id: OWNER, name: "Test Driver Two", cdl_number: null, cdl_state: null, active: true },
    ],
    settlementLines: [], drafts: [], paymentConflicts: new Map(), otherDocuments: [],
    ...over,
  };
}

/** Acknowledge every current warning (what a careful owner would do after reading them). */
export const NEW_DRAFT = { kind: "new_draft" as const, periodStart: "2026-10-12", periodEnd: "2026-10-18", applyRecurring: false };
