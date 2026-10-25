// =============================================================================
//  Automatic payroll — decisions (pure)
// -----------------------------------------------------------------------------
//  Turns the Smart Payroll proposal into the choices an owner would make, but
//  ONLY when no judgement is needed. Anything that would need a human — a
//  conflict between the paperwork and the load record, a possible duplicate,
//  an unverified carrier, two candidate drafts, a driver with no pay rule —
//  becomes a HOLD with a plain-language reason, and nothing is written.
//
//  Money is never decided here: the draft line comes from the STORED load
//  record and the driver's stored pay rule, through the shared settlement
//  engine (the same cents as the iPhone).
// =============================================================================

import type { PayrollProposal, ProposalDecisions } from "../payrollUpload/proposal";
import type { Deduction, DeductionCategory, Responsibility } from "../settlements/model";
import { responsibilityFor, type DriverPaySettings } from "../settlements/workflow";
import { Money } from "../money/money";

export interface AutoHold {
  code: string;
  message: string;
}

/** Monday–Sunday week containing `ymd` (the New Settlement screen's default period). */
export function payWeekFor(ymd: string): { start: string; end: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon = 0
  const f = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: f(t - dow * 86_400_000), end: f(t + (6 - dow) * 86_400_000) };
}

/**
 * Warnings that are pure information for an automatic run. Everything else
 * (conflicts, duplicates, identity, driver name mismatches, validation
 * warnings) is a reason to hold.
 */
const INFORMATIONAL_WARNINGS = new Set<string>([
  // A web upload always has a fingerprint; this only appears for old iPhone files.
]);

/** Holds for a proposal built WITH the automatic decisions. */
export function holdsOf(p: PayrollProposal): AutoHold[] {
  const out: AutoHold[] = [];
  for (const b of p.blockers) out.push({ code: b.code, message: b.message });
  for (const w of p.warnings) {
    if (w.acknowledged || INFORMATIONAL_WARNINGS.has(w.code)) continue;
    out.push({ code: w.code, message: w.message });
  }
  for (const n of p.needs) {
    if (n.startsWith("acknowledge:")) continue; // reported as the warning itself
    if (n === "choose_load") out.push({ code: "choose_load", message: "More than one of your loads has this load number. Pick the right one." });
    else if (n === "choose_target") out.push({ code: "choose_target", message: "Choose which settlement draft this load goes on." });
    else if (n === "enter_period") out.push({ code: "enter_period", message: "Enter the pay period." });
    else out.push({ code: n, message: "Finish the review." });
  }
  return dedupe(out);
}

function dedupe(h: AutoHold[]): AutoHold[] {
  const seen = new Set<string>();
  return h.filter((x) => (seen.has(x.code + x.message) ? false : (seen.add(x.code + x.message), true)));
}

/**
 * The owner's choices, made automatically from a FIRST-PASS proposal (built
 * with only the routed load). Returns holds instead when a choice would need
 * judgement.
 */
export function automaticDecisions(
  first: PayrollProposal,
  routedLoadId: string | null,
): { decisions: ProposalDecisions; holds: AutoHold[] } {
  const holds: AutoHold[] = [];
  const decisions: ProposalDecisions = {};
  if (first.status === "reference_only" || first.status === "supporting_document" || first.status === "not_payroll") {
    return { decisions, holds: [{ code: `not_a_pay_document:${first.status}`, message: "This document doesn't create pay on its own." }] };
  }
  // Load: the one the filing step attached (never a guess between candidates).
  if (routedLoadId) decisions.loadId = routedLoadId;
  const selected = first.load.selected ?? first.load.candidates.find((c) => c.id === routedLoadId) ?? null;
  if (!selected) {
    // Blockers (load not found etc.) are reported by holdsOf on the second pass.
    return { decisions, holds };
  }
  const opts = first.target.options;
  if (opts.length > 1) {
    holds.push({ code: "multiple_drafts", message: `This driver has ${opts.length} open drafts covering the load's date. Choose one.` });
    return { decisions, holds };
  }
  if (opts.length === 1) {
    decisions.target = { kind: "existing_draft", settlementId: opts[0].id };
  } else {
    const pd = selected.delivery_date?.slice(0, 10) ?? selected.pickup_date?.slice(0, 10) ?? null;
    if (!pd) return { decisions, holds }; // reported as load_not_delivered
    const w = payWeekFor(pd);
    // Authorized recurring deductions (truck lease, insurance…) apply exactly
    // as on the New Settlement screen.
    decisions.target = { kind: "new_draft", periodStart: w.start, periodEnd: w.end, applyRecurring: true };
  }
  return { decisions, holds };
}

/** A driver whose stored pay rule produces no earnings can't be paid automatically. */
export function payRuleHold(pay: DriverPaySettings | null): AutoHold | null {
  if (!pay) return { code: "driver_pay_unknown", message: "The driver's pay settings couldn't be read." };
  if (pay.payRule.components.length === 0) {
    return { code: "no_pay_agreement", message: "This driver has no pay rule (percentage, per mile, flat…). Set it on the driver, then this draft is made automatically." };
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Receipts → driver deductions (only where the driver's terms say so)
// ---------------------------------------------------------------------------

/** expenses.category -> settlement deduction category. Lumper is not a driver charge by default. */
export const EXPENSE_TO_DEDUCTION: Readonly<Record<string, DeductionCategory | null>> = {
  fuel: "fuel",
  toll: "tolls",
  maintenance: "repair",
  scale: "scale_tickets",
  lumper: null,
};

export interface ExpenseRow {
  id: string;
  load_id: string | null;
  category: string | null;
  amount: number | string | null;
  receipt_date: string | null;
  vendor_name: string | null;
  source_document_id: string | null;
}

export function deductionsForExpenses(
  expenses: readonly ExpenseRow[],
  pay: DriverPaySettings,
  alreadyDeducted: ReadonlySet<string>,
): Deduction[] {
  const out: Deduction[] = [];
  for (const e of expenses) {
    if (alreadyDeducted.has(e.id)) continue;
    const cat = EXPENSE_TO_DEDUCTION[(e.category ?? "").toLowerCase()];
    if (!cat) continue;
    const amt = Money.fromNumber(typeof e.amount === "string" ? Number(e.amount) : e.amount);
    if (!amt.isPositive()) continue;
    const r: { responsibility: Responsibility; driverSharePercent: string } = responsibilityFor(cat, pay);
    if (r.responsibility === "company") continue;
    out.push({
      id: "server", category: cat, customCategoryId: null,
      description: `${e.vendor_name ? e.vendor_name : "Receipt"}${e.receipt_date ? ` ${e.receipt_date.slice(0, 10)}` : ""}`.slice(0, 200),
      amount: amt.rounded().toFixed2(), date: e.receipt_date ? e.receipt_date.slice(0, 10) : null,
      relatedLoadId: e.load_id, relatedExpenseId: e.id, documentId: e.source_document_id,
      notes: "Added automatically from an uploaded receipt.",
      responsibility: r.responsibility, driverSharePercent: r.driverSharePercent,
      recurringDeductionId: null, advanceId: null, sortOrder: 0, createdAt: null,
    });
  }
  return out;
}
