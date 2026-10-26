// =============================================================================
//  Automatic payroll — orchestration (server; dependencies injected)
// -----------------------------------------------------------------------------
//  Called after a document has been read and filed. It never decides money
//  and never approves or pays anything. Every write goes through code that
//  already exists and is already tested:
//
//    rate confirmation on a load  -> confirmPayrollDraft (claims: one draft
//                                    per load / document, crash recovery)
//                                 -> createSettlementAction /
//                                    saveSettlementAction core
//                                 -> sph_web_save_settlement (one transaction)
//    receipt on a load            -> saveSettlementCore with a trusted,
//                                    expense-linked deduction, only when the
//                                    driver's terms make that cost the
//                                    driver's, only on an editable draft
//
//  Outcomes are recorded on the document (routing.autopay + history) so the
//  carrier sees exactly what happened and why something is waiting.
//  Idempotent: re-running for the same document is safe (claims, "already
//  linked" checks, expense-linked deduction de-duplication).
// =============================================================================

import type { ConfirmResult } from "../payrollUpload/confirm";
import type { PayrollProposal, ProposalDecisions } from "../payrollUpload/proposal";
import type { Deduction } from "../settlements/model";
import type { DriverPaySettings } from "../settlements/workflow";
import { automaticDecisions, deductionsForExpenses, holdsOf, payRuleHold, type AutoHold, type ExpenseRow } from "./plan";
import { payPeriodFor, type PeriodSetting } from "./period";

export type AutoState = "drafted" | "added_to_draft" | "deduction_added" | "noted" | "held" | "skipped" | "off" | "error";

/**
 * Lumper (owner decision 2026-10-25): reimbursed to the driver only when a
 * verified pay rule AND evidence establish it is owed. No such rule exists in
 * the data model today (pay rules, lease rules and custom categories carry no
 * lumper-reimbursement term), so a lumper receipt is never added to driver pay;
 * when the load is on a driver's draft the carrier is told, so it isn't missed.
 */
export const LUMPER_NOTE = "Lumper receipt filed as a company expense. It was not added to the driver's pay: no verified pay rule says lumpers are reimbursed. If the driver paid it, add a Lumper Reimbursement on the settlement.";

export interface AutoOutcome {
  state: AutoState;
  /** Plain-language reasons the carrier needs to act on (state = held). */
  holds: AutoHold[];
  settlementId?: string;
  deductionsAdded?: number;
  detail?: string;
}

export interface AutoDocument {
  id: string;
  profile_id: string;
  load_id: string | null;
  settlement_id: string | null;
  review_status: string | null;
  /** Routing type from the filing step (rate_confirmation, fuel_receipt, …). */
  routedType: string | null;
}

export interface LiveDraft {
  settlementId: string;
  status: string;
  updatedAt: string | null;
  driverId: string | null;
  loadIds: string[];
  relatedExpenseIds: string[];
}

export interface AutoDeps {
  enabled: boolean;
  disabledReason: string;
  getDocument(id: string): Promise<AutoDocument | null>;
  /** Smart Payroll proposal (fresh server reads), with the given decisions. */
  proposal(documentId: string, decisions: ProposalDecisions): Promise<PayrollProposal>;
  driverPay(driverId: string): Promise<DriverPaySettings | null>;
  /** drivers.pay_frequency + this driver's recent settlement periods. */
  driverPeriod?(driverId: string): Promise<PeriodSetting>;
  loadDriver(loadId: string): Promise<string | null>;
  /**
   * Among this document and its same-identity copies (re-scans of the same
   * rate con), true when THIS one is the earliest upload and no copy is on a
   * settlement. Only that one may proceed; later copies stay held.
   */
  isEarliestUnlinkedCopy?(documentId: string, sameIdentityIds: string[]): Promise<boolean>;
  /** confirmPayrollDraft with mode "automatic". */
  confirm(documentId: string, decisions: ProposalDecisions): Promise<ConfirmResult>;
  /** Expenses linked to this load (any source). */
  expensesForLoad(loadId: string): Promise<ExpenseRow[]>;
  /** The expense created from this document, if any. */
  expenseForDocument(documentId: string): Promise<ExpenseRow | null>;
  /** Expense ids already deducted on any live (non-voided) settlement. */
  deductedExpenseIds(expenseIds: string[]): Promise<Set<string>>;
  /** The editable draft (draft / ready_for_review) that carries this load, if exactly one. */
  draftForLoad(loadId: string): Promise<LiveDraft | null | "ambiguous">;
  addDeductions(settlementId: string, expectedUpdatedAt: string | null, deductions: Deduction[]): Promise<{ ok: true } | { ok: false; error: string }>;
  record(documentId: string, outcome: AutoOutcome): Promise<void>;
}

const RATE_CON = "rate_confirmation";
const RECEIPTS = new Set(["fuel_receipt", "toll", "repair", "scale_ticket", "lumper_fee"]);

export async function autoPayrollForDocument(deps: AutoDeps, documentId: string): Promise<AutoOutcome> {
  if (!deps.enabled) return { state: "off", holds: [], detail: deps.disabledReason };
  const doc = await deps.getDocument(documentId);
  if (!doc) return { state: "skipped", holds: [], detail: "not_found" };
  if (doc.review_status !== "auto_routed" && doc.review_status !== "approved") {
    return { state: "skipped", holds: [], detail: "not_filed" };
  }
  let out: AutoOutcome;
  try {
    if (doc.routedType === RATE_CON) out = await rateConfirmation(deps, doc);
    else if (doc.routedType && RECEIPTS.has(doc.routedType)) out = await receipt(deps, doc);
    else return { state: "skipped", holds: [], detail: "no_pay_effect" };
  } catch (e) {
    out = { state: "error", holds: [{ code: "automation_error", message: "Automatic payroll couldn't finish. Nothing was half-saved; open the document to continue." }], detail: (e as Error).message.slice(0, 300) };
  }
  await deps.record(documentId, out).catch(() => undefined);
  return out;
}

async function rateConfirmation(deps: AutoDeps, doc: AutoDocument): Promise<AutoOutcome> {
  if (doc.settlement_id) return { state: "skipped", holds: [], settlementId: doc.settlement_id, detail: "already_on_settlement" };
  if (!doc.load_id) return { state: "held", holds: [{ code: "no_load", message: "This rate confirmation isn't on a load yet." }] };

  // 1. First pass: what the paperwork and the records say, with the filed load.
  const first = await deps.proposal(doc.id, { loadId: doc.load_id });
  const driverId = first.driver.selected?.id ?? (await deps.loadDriver(doc.load_id));
  const period: PeriodSetting = driverId && deps.driverPeriod ? await deps.driverPeriod(driverId) : { frequency: null, recent: [] };
  const auto = automaticDecisions(first, doc.load_id, (date) => payPeriodFor(date, period));
  if (auto.holds.length) return { state: "held", holds: auto.holds };

  // 2. The driver must have a stored pay agreement (never invent a rate).
  if (driverId) {
    const h = payRuleHold(await deps.driverPay(driverId));
    if (h) return { state: "held", holds: [h] };
  }

  // 3. Second pass with the automatic choices: every warning/blocker = hold.
  let second = await deps.proposal(doc.id, auto.decisions);
  let holds = holdsOf(second);
  // Re-scans of the same rate con: the earliest upload goes ahead (the copy
  // is recorded as acknowledged on the confirmation); later copies stay held.
  if (holds.length && holds.every((h) => h.code === "possible_duplicate") && deps.isEarliestUnlinkedCopy
      && (await deps.isEarliestUnlinkedCopy(doc.id, second.duplicates?.sameIdentityIds ?? []))) {
    auto.decisions.acknowledged = [...(auto.decisions.acknowledged ?? []), "duplicate:possible"];
    second = await deps.proposal(doc.id, auto.decisions);
    holds = holdsOf(second);
  }
  if (holds.length || !second.canConfirm) {
    return { state: "held", holds: holds.length ? holds : [{ code: "not_ready", message: "This load isn't ready for payroll yet." }] };
  }

  // 4. Draft through the claim-protected confirmation.
  const r = await deps.confirm(doc.id, auto.decisions);
  if (!r.ok) {
    if (r.code === "already_confirmed" || r.code === "document_already_linked") return { state: "skipped", holds: [], detail: r.code };
    return { state: "held", holds: [{ code: r.code, message: r.error }] };
  }
  const state: AutoState = r.created ? "drafted" : "added_to_draft";

  // 5. Receipts that already arrived for this load (out-of-order uploads).
  const added = await attachLoadExpenses(deps, doc.load_id, driverId);
  return { state, holds: [], settlementId: r.settlementId, deductionsAdded: added.count, ...(added.hold ? { detail: added.hold.message } : {}) };
}

async function attachLoadExpenses(deps: AutoDeps, loadId: string, driverId: string | null): Promise<{ count: number; hold?: AutoHold }> {
  if (!driverId) return { count: 0 };
  const pay = await deps.driverPay(driverId);
  if (!pay) return { count: 0 };
  const expenses = await deps.expensesForLoad(loadId);
  if (!expenses.length) return { count: 0 };
  const draft = await deps.draftForLoad(loadId);
  if (!draft || draft === "ambiguous") return { count: 0 };
  const done = await deps.deductedExpenseIds(expenses.map((e) => e.id));
  for (const x of draft.relatedExpenseIds) done.add(x);
  const ds = deductionsForExpenses(expenses, pay, done);
  if (!ds.length) return { count: 0 };
  const r = await deps.addDeductions(draft.settlementId, draft.updatedAt, ds);
  return r.ok ? { count: ds.length } : { count: 0, hold: { code: "deduction_not_added", message: r.error } };
}

async function receipt(deps: AutoDeps, doc: AutoDocument): Promise<AutoOutcome> {
  const expense = await deps.expenseForDocument(doc.id);
  if (!expense) return { state: "skipped", holds: [], detail: "no_expense" };
  if (!expense.load_id) return { state: "skipped", holds: [], detail: "company_expense" };
  const draft = await deps.draftForLoad(expense.load_id);
  if (draft === "ambiguous") return { state: "held", holds: [{ code: "multiple_drafts", message: "This receipt's load is on more than one open draft. Add the deduction on the right one." }] };
  if (!draft) return { state: "skipped", holds: [], detail: "load_not_on_draft_yet" }; // picked up when the draft is made
  const driverId = draft.driverId ?? (await deps.loadDriver(expense.load_id));
  if (!driverId) return { state: "skipped", holds: [], detail: "no_driver" };
  const pay = await deps.driverPay(driverId);
  if (!pay) return { state: "skipped", holds: [], detail: "driver_pay_unknown" };
  if ((expense.category ?? "").toLowerCase() === "lumper") {
    return { state: "noted", holds: [{ code: "lumper_not_reimbursed", message: LUMPER_NOTE }], settlementId: draft.settlementId };
  }
  const done = await deps.deductedExpenseIds([expense.id]);
  for (const x of draft.relatedExpenseIds) done.add(x);
  const ds = deductionsForExpenses([expense], pay, done);
  if (!ds.length) return { state: "skipped", holds: [], settlementId: draft.settlementId, detail: "not_a_driver_charge" };
  const r = await deps.addDeductions(draft.settlementId, draft.updatedAt, ds);
  if (!r.ok) return { state: "held", holds: [{ code: "deduction_not_added", message: r.error }] };
  return { state: "deduction_added", holds: [], settlementId: draft.settlementId, deductionsAdded: ds.length };
}
