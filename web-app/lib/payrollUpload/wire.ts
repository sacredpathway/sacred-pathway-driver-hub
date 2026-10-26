// =============================================================================
//  Smart Payroll Upload — wiring of confirmPayrollDraft to the real services
//  (server only). Kept out of the "use server" file so it can be unit-tested.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditPayload } from "@/lib/settlements/payload";
import type { ConfirmDeps } from "./confirm";
import { payrollConfirmGate } from "./featureFlag";
import {
  addLoadToDraftVia, claimVia, finalizeClaimVia, getCarrierProfile, getProposalDocument, readProposalInput, recoverVia, releaseClaimVia,
} from "./server";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export interface SettlementActions {
  createSettlementAction(input: { driverId: string; periodStart: string; periodEnd: string; loadIds: string[]; applyRecurring: boolean; hoursWorked: string; clientToday?: string }): Promise<Result<{ id: string }>>;
  saveSettlementAction(settlementId: string, expectedUpdatedAt: string | null, payload: EditPayload): Promise<Result>;
}

export function makeConfirmDeps(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  actions: SettlementActions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfirmDeps {
  return {
    gate: payrollConfirmGate(env),
    now: () => new Date(),
    getProfile: (id) => getCarrierProfile(supabase, id),
    getDocument: (id) => getProposalDocument(supabase, userId, id),
    proposalInput: (doc, profile, decisions) => readProposalInput(supabase, doc, profile, decisions, today),
    createDraft: async (input) => {
      const r = await actions.createSettlementAction(input);
      return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
    },
    addLoadToDraft: (settlementId, expectedUpdatedAt, loadId) =>
      addLoadToDraftVia(supabase, userId, async (id, exp, payload) => {
        const r = await actions.saveSettlementAction(id, exp, payload);
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }, settlementId, expectedUpdatedAt, loadId),
    recover: (documentId) => recoverVia(supabase, documentId),
    claim: (input) => claimVia(supabase, input),
    releaseClaim: (claim, reason) => releaseClaimVia(supabase, claim, reason),
    finalizeClaim: (claim, settlementId, confirmation) => finalizeClaimVia(supabase, claim, settlementId, confirmation),
  };
}
