// =============================================================================
//  Smart Payroll Upload — untrusted browser decisions -> typed decisions (pure)
//  Unknown keys are dropped; ids must be UUIDs; dates YYYY-MM-DD; at most 50
//  corrections / 100 acknowledgements. The proposal then re-validates
//  everything against fresh server reads.
// =============================================================================

import { UUID_RE, isYmd } from "../settlements/input";
import { PAYROLL_FIELD_SPECS } from "../documents/payrollExtraction";
import type { ProposalDecisions } from "./proposal";

export function sanitizeDecisions(raw: unknown): ProposalDecisions {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: ProposalDecisions = {};
  if (typeof o.loadId === "string" && UUID_RE.test(o.loadId)) out.loadId = o.loadId.toLowerCase();

  const t = o.target && typeof o.target === "object" ? o.target as Record<string, unknown> : null;
  if (t?.kind === "existing_draft" && typeof t.settlementId === "string" && UUID_RE.test(t.settlementId)) {
    out.target = { kind: "existing_draft", settlementId: t.settlementId.toLowerCase() };
  } else if (t?.kind === "new_draft") {
    out.target = {
      kind: "new_draft",
      periodStart: typeof t.periodStart === "string" && isYmd(t.periodStart) ? t.periodStart : "",
      periodEnd: typeof t.periodEnd === "string" && isYmd(t.periodEnd) ? t.periodEnd : "",
      applyRecurring: t.applyRecurring === true,
    };
  }

  const c = o.corrections && typeof o.corrections === "object" && !Array.isArray(o.corrections) ? o.corrections as Record<string, unknown> : {};
  const corrections: Record<string, { value: unknown; note?: string }> = {};
  for (const [k, v] of Object.entries(c).slice(0, 50)) {
    if (!PAYROLL_FIELD_SPECS[k] || !v || typeof v !== "object") continue;
    const e = v as { value?: unknown; note?: unknown };
    const value = typeof e.value === "string" || typeof e.value === "number" || typeof e.value === "boolean" ? e.value : null;
    if (value === null) continue;
    corrections[k] = { value, ...(typeof e.note === "string" ? { note: e.note.slice(0, 200) } : {}) };
  }
  if (Object.keys(corrections).length) out.corrections = corrections;

  if (Array.isArray(o.acknowledged)) {
    out.acknowledged = o.acknowledged.filter((x): x is string => typeof x === "string" && x.length <= 120).slice(0, 100);
  }
  return out;
}
