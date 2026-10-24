// =============================================================================
//  Smart Payroll Upload — explicit confirmation → settlement DRAFT
// -----------------------------------------------------------------------------
//  Order (every step must pass, otherwise nothing is written):
//    1. confirmation gate (local test database only — see featureFlag.ts);
//    2. carrier OWNER account (driver / dispatcher accounts refused);
//    3. the document is this account's (RLS + code);
//    4. the proposal is rebuilt on the SERVER from fresh reads and the
//       owner's decisions — the browser's view of it is never trusted;
//    5. the plan is executed through the EXISTING settlement actions:
//         create        -> createSettlementAction (same eligibility, driver,
//                          already-paid, numbering and engine as "New
//                          settlement")
//         add_to_draft  -> saveSettlementAction (same lock, version, allowed-
//                          load and engine checks as the settlement editor)
//       both of which write through sph_web_save_settlement (migration #2/#3,
//       one transaction, lock order preserved). No other write path exists.
//    6. the document records which draft it went to (audit), so it can't be
//       confirmed twice.
//  Phase 3 — database-enforced idempotency (document_payroll_claims):
//    0. recover  : heal a previous attempt that saved its draft but died
//                  before linking (expired claim + exactly one matching line);
//    4b. claim   : ONE pending claim per document and per load (unique
//                  indexes). A second tab / double click / second document
//                  for the same load is refused BEFORE any draft is written;
//    5b. release : any refused or failed save frees the claim at once;
//    6.  finalize: verifies the draft line for the claimed load, links the
//                  document once and records the exact settlement line.
//  A crash between claim and finalize never blocks forever: the claim expires
//  (120 s) and the next attempt recovers or re-claims.
//  There is no approve / finalize / pay step anywhere in this module.
// =============================================================================

import type { ConfirmGate } from "./featureFlag";
import { GATE_MESSAGE } from "./featureFlag";
import { isCarrierOwnerAccount, type CarrierProfileRow } from "./carrierIdentity";
import { buildPayrollProposal, ForeignDocumentError, type DraftPlan, type PayrollProposal, type ProposalDecisions, type ProposalDocument, type ProposalInput } from "./proposal";
import type { Correction } from "./validation";

export type ConfirmResult =
  | { ok: true; settlementId: string; created: boolean; settlementLoadId?: string; recovered?: boolean }
  | { ok: false; error: string; code: string; proposal?: PayrollProposal };

export interface ConfirmationRecord {
  confirmed_by: string;
  requested_at: string;
  plan: DraftPlan["kind"];
  load_id: string;
  corrections: Correction[];
  acknowledged: string[];
}

export interface ClaimHandle { claimId: string; claimToken: string }
export type ClaimResult = ({ ok: true } & ClaimHandle) | { ok: false; code: string; error: string };
export type FinalizeResult = { ok: true; settlementLoadId: string } | { ok: false; code: string; error: string };
export type RecoverResult =
  | { ok: true; state: "none" | "released" | "ambiguous" }
  | { ok: true; state: "linked" | "recovered"; settlementId: string; settlementLoadId?: string; plan?: DraftPlan["kind"] }
  | { ok: false; code: string; error: string };

export interface ConfirmDeps {
  gate: ConfirmGate;
  now(): Date;
  getProfile(userId: string): Promise<CarrierProfileRow | null>;
  getDocument(documentId: string): Promise<ProposalDocument | null>;
  /** Fresh server-side reads for the proposal (RLS-scoped). */
  proposalInput(doc: ProposalDocument, profile: CarrierProfileRow, decisions: ProposalDecisions): Promise<ProposalInput>;
  /** Existing createSettlementAction. */
  createDraft(input: { driverId: string; periodStart: string; periodEnd: string; loadIds: string[]; applyRecurring: boolean; hoursWorked: string; clientToday?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Existing saveSettlementAction with the load appended (see server.ts). */
  addLoadToDraft(settlementId: string, expectedUpdatedAt: string | null, loadId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** sph_payroll_claim_recover */
  recover(documentId: string): Promise<RecoverResult>;
  /** sph_payroll_claim */
  claim(input: { documentId: string; loadId: string; plan: DraftPlan["kind"]; targetSettlementId: string | null; confirmation: ConfirmationRecord }): Promise<ClaimResult>;
  /** sph_payroll_claim_release */
  releaseClaim(claim: ClaimHandle, reason: string): Promise<void>;
  /** sph_payroll_claim_finalize */
  finalizeClaim(claim: ClaimHandle, settlementId: string, confirmation: ConfirmationRecord): Promise<FinalizeResult>;
}

export async function confirmPayrollDraft(
  deps: ConfirmDeps,
  user: { id: string; email: string | null },
  documentId: string,
  decisions: ProposalDecisions,
  clientToday?: string,
): Promise<ConfirmResult> {
  if (!deps.gate.enabled) return { ok: false, code: "confirm_disabled", error: GATE_MESSAGE[deps.gate.reason] };

  const profile = await deps.getProfile(user.id);
  if (!profile || profile.id !== user.id || !isCarrierOwnerAccount(profile)) {
    return { ok: false, code: "not_owner", error: "Only the carrier owner account can turn documents into payroll." };
  }

  const doc = await deps.getDocument(documentId);
  if (!doc || doc.profile_id !== user.id) return { ok: false, code: "not_found", error: "Document not found." };

  // 0. A previous attempt that saved its draft but never linked it is healed
  //    here instead of producing a second draft.
  if (!doc.settlement_id) {
    const rec = await deps.recover(documentId);
    if (!rec.ok) return { ok: false, code: rec.code, error: rec.error };
    if (rec.state === "recovered") {
      return { ok: true, settlementId: rec.settlementId, settlementLoadId: rec.settlementLoadId, created: rec.plan !== "add_to_draft", recovered: true };
    }
    if (rec.state === "linked") {
      return { ok: false, code: "already_confirmed", error: "This document is already linked to a settlement." };
    }
    if (rec.state === "ambiguous") {
      return { ok: false, code: "recovery_ambiguous", error: "An earlier confirmation of this document was interrupted and its load is now on more than one draft. Open Settlements and check those drafts before confirming again." };
    }
  }

  let proposal: PayrollProposal;
  try {
    proposal = buildPayrollProposal(await deps.proposalInput(doc, profile, decisions));
  } catch (e) {
    if (e instanceof ForeignDocumentError) return { ok: false, code: "not_found", error: "Document not found." };
    throw e;
  }
  if (!proposal.canConfirm || !proposal.plan) {
    const first = proposal.blockers[0]?.message ?? (proposal.needs.length ? "Finish the review first: some choices or acknowledgements are still open." : "This document can't become a payroll draft.");
    return { ok: false, code: proposal.blockers[0]?.code ?? "not_ready", error: first, proposal };
  }

  const plan = proposal.plan;
  const confirmation: ConfirmationRecord = {
    confirmed_by: user.id,
    requested_at: deps.now().toISOString(),
    plan: plan.kind,
    load_id: plan.loadId,
    corrections: proposal.fields
      .filter((f) => f.evidence === "corrected_by_owner")
      .map((f) => ({ field: f.field, extracted: f.readAs ?? null, saved: f.extracted, source: "manual" as const })),
    acknowledged: proposal.warnings.map((w) => w.key),
  };

  // 4b. Atomic claim: nothing is written to payroll unless this succeeds.
  const claim = await deps.claim({
    documentId, loadId: plan.loadId, plan: plan.kind,
    targetSettlementId: plan.kind === "add_to_draft" ? plan.settlementId : null, confirmation,
  });
  if (!claim.ok) return { ok: false, code: claim.code, error: claim.error, proposal };
  const handle: ClaimHandle = { claimId: claim.claimId, claimToken: claim.claimToken };

  // 5. The existing settlement actions write the draft.
  // An exception here (e.g. network) leaves the claim pending on purpose: if
  // the draft was saved, the next attempt recovers it after expiry; if not,
  // the claim expires. Either way no second draft can be created meanwhile.
  let settlementId: string;
  if (plan.kind === "create") {
    const r = await deps.createDraft({
      driverId: plan.driverId, periodStart: plan.periodStart, periodEnd: plan.periodEnd,
      loadIds: [plan.loadId], applyRecurring: plan.applyRecurring, hoursWorked: "", clientToday,
    });
    if (!r.ok) {
      await deps.releaseClaim(handle, "save_refused");
      return { ok: false, code: "draft_refused", error: r.error, proposal };
    }
    settlementId = r.id;
  } else {
    const r = await deps.addLoadToDraft(plan.settlementId, plan.expectedUpdatedAt, plan.loadId);
    if (!r.ok) {
      await deps.releaseClaim(handle, "save_refused");
      return { ok: false, code: "draft_refused", error: r.error, proposal };
    }
    settlementId = plan.settlementId;
  }

  // 6. Link + audit (verifies the draft line in the database).
  const fin = await deps.finalizeClaim(handle, settlementId, confirmation);
  if (!fin.ok) {
    // The draft exists and is fully editable; the claim stays pending so the
    // next attempt links it (sph_payroll_claim_recover) instead of duplicating.
    return { ok: false, code: "draft_saved_link_failed", error: `The draft was saved, but linking the document failed: ${fin.error}. Open the settlement to continue, or confirm again in two minutes to link it.` };
  }
  return { ok: true, settlementId, settlementLoadId: fin.settlementLoadId, created: plan.kind === "create" };
}
