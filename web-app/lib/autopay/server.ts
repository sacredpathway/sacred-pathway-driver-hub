// =============================================================================
//  Automatic payroll — entry points used by server actions (server only)
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { createDocumentRepo } from "../documents/repo";
import { rerouteWaitingForLoad } from "../documents/pipeline";
import { resolveToday } from "../settlements/workflow";
import { saveSettlementCore } from "../settlements/core";
import type { SettlementActions } from "../payrollUpload/wire";
import { autoPayrollForDocument, type AutoOutcome } from "./run";
import { makeAutoDeps } from "./wire";

export interface AutopaySummary {
  state: AutoOutcome["state"];
  message: string;
  settlementId?: string;
  holds: { code: string; message: string }[];
}

export function describeOutcome(o: AutoOutcome): string {
  switch (o.state) {
    case "drafted": return `Payroll draft created${o.deductionsAdded ? ` (+${o.deductionsAdded} receipt deduction${o.deductionsAdded === 1 ? "" : "s"})` : ""}. Review and approve it on the settlement — nothing is paid automatically.`;
    case "added_to_draft": return `Added to the driver's open payroll draft${o.deductionsAdded ? ` (+${o.deductionsAdded} receipt deduction${o.deductionsAdded === 1 ? "" : "s"})` : ""}.`;
    case "deduction_added": return "Receipt added as a deduction on the driver's payroll draft.";
    case "noted": return o.holds[0]?.message ?? "";
    case "held": return `Payroll waiting: ${o.holds[0]?.message ?? "needs your review."}`;
    case "error": return o.holds[0]?.message ?? "Automatic payroll couldn't finish.";
    case "off": return "";
    case "skipped": return "";
  }
}

export function summary(o: AutoOutcome): AutopaySummary {
  return { state: o.state, message: describeOutcome(o), ...(o.settlementId ? { settlementId: o.settlementId } : {}), holds: o.holds };
}

export async function runAutoPayroll(
  supabase: SupabaseClient,
  user: { id: string; email: string | null },
  documentId: string,
  actions: SettlementActions,
): Promise<AutoOutcome> {
  const deps = makeAutoDeps(supabase, {
    today: resolveToday(null, new Date()),
    user,
    actions,
    saveCore: async (c, id, exp, payload, opts) => {
      const r = await saveSettlementCore(c, id, exp, payload, opts);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
  });
  return autoPayrollForDocument(deps, documentId);
}

/**
 * Everything that should happen after ONE document was filed:
 *   1. its own payroll effect (draft / deduction / hold);
 *   2. if it put a load in place, documents that were waiting for that load
 *      are re-matched and get their payroll effect too.
 */
export async function afterFiling(
  supabase: SupabaseClient,
  user: { id: string; email: string | null },
  documentId: string,
  actions: SettlementActions,
  loadId: string | null,
): Promise<{ own: AutoOutcome; followUps: Array<{ documentId: string; outcome: AutoOutcome }> }> {
  const followUps: Array<{ documentId: string; outcome: AutoOutcome }> = [];
  // Waiting paperwork first, so a receipt that arrived before the rate con is
  // already an expense on the load when the draft is made.
  if (loadId) {
    const filed = await rerouteWaitingForLoad(createDocumentRepo(supabase, user.id), loadId).catch(() => [] as string[]);
    for (const id of filed) followUps.push({ documentId: id, outcome: { state: "skipped", holds: [] } });
  }
  const own = await runAutoPayroll(supabase, user, documentId, actions);
  for (const f of followUps) f.outcome = await runAutoPayroll(supabase, user, f.documentId, actions);
  return { own, followUps };
}

/** A load just appeared (created by hand or from a document): file what was waiting for it. */
export async function afterLoadCreated(
  supabase: SupabaseClient,
  user: { id: string; email: string | null },
  loadId: string,
  actions: SettlementActions,
): Promise<number> {
  const filed = await rerouteWaitingForLoad(createDocumentRepo(supabase, user.id), loadId).catch(() => [] as string[]);
  for (const id of filed) await runAutoPayroll(supabase, user, id, actions);
  return filed.length;
}
