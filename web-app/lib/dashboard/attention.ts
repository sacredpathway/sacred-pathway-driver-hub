// =============================================================================
//  Missing paperwork info — facts the app can prove from each load record
// -----------------------------------------------------------------------------
//  No pickup/drop-off tracking (owner rule): nothing here looks at load status
//  except to skip cancelled loads. Each rule is a blank field that changes a
//  calculation, checked for loads dated in the last ATTENTION_WINDOW_DAYS
//  (by delivery → pickup → created date) so old history doesn't bury the list.
//
//   no_rate               total_revenue empty or 0      → revenue / pay undercount
//   no_miles              total_miles empty or 0        → revenue per mile skips it
//   no_driver             driver_id empty (admins only) → can't be paid to a driver
//   no_delivery_date      delivery_date empty           → counted by pickup date
//   no_rate_confirmation  no rate_confirmation document linked (only when the
//                         documents read succeeded)
// =============================================================================

import { loadPeriodDate } from "@/lib/loads/periodDate";
import { addDaysYmd, isCancelledLoad, type DashboardLoad } from "./loadState";

export const ATTENTION_WINDOW_DAYS = 30;

export type AttentionRule =
  | "no_rate"
  | "no_miles"
  | "no_driver"
  | "no_delivery_date"
  | "no_rate_confirmation";

export const ATTENTION_RULES: Record<AttentionRule, { title: string; action: string }> = {
  no_rate:              { title: "No rate entered",               action: "Add rate" },
  no_miles:             { title: "No miles entered",              action: "Add miles" },
  no_driver:            { title: "No driver assigned",            action: "Assign driver" },
  no_delivery_date:     { title: "No delivery date",              action: "Add date" },
  no_rate_confirmation: { title: "No rate confirmation attached", action: "Open load" },
};

/** Order = impact on the numbers. */
const RULE_ORDER: AttentionRule[] = ["no_rate", "no_miles", "no_driver", "no_delivery_date", "no_rate_confirmation"];

export interface AttentionItem {
  rule: AttentionRule;
  loadId: string;
  loadLabel: string;
  detail: string;
  href: string;
}

export interface AttentionInput {
  loads: ReadonlyArray<DashboardLoad>;
  /** "YYYY-MM-DD" (UTC). */
  today: string;
  includeDriverAssignment: boolean;
  /** Load ids with a rate confirmation; null = documents not read → rule skipped. */
  loadIdsWithRateConfirmation: ReadonlySet<string> | null;
  windowDays?: number;
}

export interface AttentionSummary {
  items: AttentionItem[];
  countsByRule: Record<AttentionRule, number>;
  total: number;
  windowDays: number;
}

function label(l: DashboardLoad): string {
  const n = (l.load_number ?? "").trim();
  return n ? `Load ${n}` : "Load (no number)";
}

function route(l: DashboardLoad): string {
  return [l.origin, l.destination].filter((s) => s && s.trim()).join(" → ");
}

export function attentionItems(input: AttentionInput): AttentionSummary {
  const { loads, today, includeDriverAssignment, loadIdsWithRateConfirmation } = input;
  const windowDays = input.windowDays ?? ATTENTION_WINDOW_DAYS;
  const since = addDaysYmd(today, -windowDays);
  const items: AttentionItem[] = [];

  for (const l of loads) {
    if (isCancelledLoad(l)) continue;
    const d = loadPeriodDate(l);
    if (!d || d < since) continue;

    const base = { loadId: l.id, loadLabel: label(l) };
    const where = route(l) || "Route not set";
    const edit = `/loads/${l.id}/edit`;

    if (!l.total_revenue) items.push({ ...base, rule: "no_rate", detail: where, href: edit });
    if (!l.total_miles) items.push({ ...base, rule: "no_miles", detail: where, href: edit });
    if (includeDriverAssignment && !l.driver_id) items.push({ ...base, rule: "no_driver", detail: where, href: `/loads/${l.id}` });
    if (!l.delivery_date) items.push({ ...base, rule: "no_delivery_date", detail: "Counted by pickup date until set", href: edit });
    if (loadIdsWithRateConfirmation !== null && !loadIdsWithRateConfirmation.has(l.id)) {
      items.push({ ...base, rule: "no_rate_confirmation", detail: where, href: `/loads/${l.id}` });
    }
  }

  items.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  const countsByRule = Object.fromEntries(RULE_ORDER.map((r) => [r, 0])) as Record<AttentionRule, number>;
  for (const i of items) countsByRule[i.rule] += 1;
  return { items, countsByRule, total: items.length, windowDays };
}

/** Set of load ids that have a rate confirmation, from documents rows. */
export function rateConfirmationLoadIds(
  docs: ReadonlyArray<{ load_id: string | null; document_type: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const d of docs) {
    if (d.load_id && (d.document_type ?? "").trim().toLowerCase() === "rate_confirmation") ids.add(d.load_id);
  }
  return ids;
}
