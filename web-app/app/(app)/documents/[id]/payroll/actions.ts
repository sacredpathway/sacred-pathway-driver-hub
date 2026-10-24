// =============================================================================
//  Smart Payroll Upload — server actions
// -----------------------------------------------------------------------------
//  refreshPayrollProposalAction  read-only: rebuilds the proposal with the
//                                owner's current choices.
//  confirmPayrollDraftAction     gated write: creates / extends a settlement
//                                DRAFT through the existing settlement actions.
//                                Disabled unless the local-test gate is on.
//  Neither action can approve, finalize or pay a settlement.
// =============================================================================

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveToday } from "@/lib/settlements/workflow";
import { UUID_RE } from "@/lib/settlements/input";
import { createSettlementAction, saveSettlementAction } from "@/app/(app)/settlements/actions";
import { buildPayrollProposal, ForeignDocumentError, type PayrollProposal, type ProposalDecisions } from "@/lib/payrollUpload/proposal";
import { confirmPayrollDraft, type ConfirmResult } from "@/lib/payrollUpload/confirm";
import { isCarrierOwnerAccount } from "@/lib/payrollUpload/carrierIdentity";
import { getCarrierProfile, getProposalDocument, readProposalInput } from "@/lib/payrollUpload/server";
import { makeConfirmDeps } from "@/lib/payrollUpload/wire";
import { sanitizeDecisions } from "@/lib/payrollUpload/decisions";

export type ProposalResult = { ok: true; proposal: PayrollProposal } | { ok: false; error: string };

export async function refreshPayrollProposalAction(documentId: string, decisions: unknown, clientToday?: string): Promise<ProposalResult> {
  if (!UUID_RE.test(documentId ?? "")) return { ok: false, error: "Document not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const profile = await getCarrierProfile(supabase, user.id);
  if (!isCarrierOwnerAccount(profile)) return { ok: false, error: "Only the carrier owner account can review payroll documents." };
  const doc = await getProposalDocument(supabase, user.id, documentId);
  if (!doc) return { ok: false, error: "Document not found." };
  try {
    const today = resolveToday(clientToday ?? null, new Date());
    const input = await readProposalInput(supabase, doc, profile!, sanitizeDecisions(decisions), today);
    return { ok: true, proposal: buildPayrollProposal(input) };
  } catch (e) {
    if (e instanceof ForeignDocumentError) return { ok: false, error: "Document not found." };
    return { ok: false, error: (e as Error).message };
  }
}

export async function confirmPayrollDraftAction(documentId: string, decisions: unknown, clientToday?: string): Promise<ConfirmResult> {
  if (!UUID_RE.test(documentId ?? "")) return { ok: false, code: "not_found", error: "Document not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_signed_in", error: "Not signed in." };
  const today = resolveToday(clientToday ?? null, new Date());
  const deps = makeConfirmDeps(supabase, user.id, today, { createSettlementAction, saveSettlementAction });
  const r = await confirmPayrollDraft(deps, { id: user.id, email: user.email ?? null }, documentId, sanitizeDecisions(decisions), clientToday);
  if (r.ok) {
    revalidatePath(`/documents/${documentId}/payroll`);
    revalidatePath("/documents");
  }
  return r;
}
