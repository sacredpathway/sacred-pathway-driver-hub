// =============================================================================
//  Attention Required — rules the app can PROVE from its own rows
// -----------------------------------------------------------------------------
//  Each rule is a plain fact about a load record. Nothing here is labelled a
//  compliance problem, and no rule depends on data the app does not have.
//
//  Rules (cancelled and settled loads are never flagged):
//
//   no_driver              active load with driver_id = null
//                          (carrier admins only — a driver's own loads are theirs)
//   no_delivery_date       active load with delivery_date = null
//                          (it is counted by pickup date until one is set)
//   status_behind_delivery status is Assigned/Dispatched/Picked Up/In Transit
//                          but delivery_date is before today
//   no_rate                non-cancelled, unsettled load with no revenue
//                          (total_revenue null or 0)
//   no_rate_confirmation   delivered, unsettled load with no document of type
//                          rate_confirmation linked to it (only evaluated when
//                          the documents read succeeded)
//
//  Every item links to the load; fixable-in-form items link to its edit page.
// =============================================================================

import { isCancelledStatus, loadStatusLabel, normalizeLoadStatus } from "@/lib/loads/status";
import { isActiveLoad, isDeliveredLoad, isSettledLoad, type DashboardLoad } from "./loadState";

export type AttentionRule =
  | "no_driver"
  | "no_delivery_date"
  | "status_behind_delivery"
  | "no_rate"
  | "no_rate_confirmation";

export const ATTENTION_RULES: Record<AttentionRule, { title: string; action: string }> = {
  no_driver:              { title: "No driver assigned",            action: "Assign driver" },
  no_delivery_date:       { title: "No delivery date",              action: "Add delivery date" },
  status_behind_delivery: { title: "Delivery date passed",          action: "Update status" },
  no_rate:                { title: "No rate entered",               action: "Add rate" },
  no_rate_confirmation:   { title: "No rate confirmation attached", action: "Open load" },
};

/** Order = severity for display. */
const RULE_ORDER: AttentionRule[] = [
  "status_behind_delivery",
  "no_driver",
  "no_delivery_date",
  "no_rate",
  "no_rate_confirmation",
];

const IN_MOTION = new Set(["assigned", "dispatched", "picked_up", "in_transit"]);

export interface AttentionItem {
  rule: AttentionRule;
  loadId: string;
  loadLabel: string;
  detail: string;
  href: string;
}

export interface AttentionInput {
  loads: ReadonlyArray<DashboardLoad>;
  today: string;
  /** Only carrier admins see driver-assignment items. */
  includeDriverAssignment: boolean;
  /**
   * load ids that have a rate_confirmation document. `null` = documents were
   * not read (or the read failed) — the rate-confirmation rule is skipped
   * rather than flagging every load.
   */
  loadIdsWithRateConfirmation: ReadonlySet<string> | null;
}

export interface AttentionSummary {
  items: AttentionItem[];
  countsByRule: Record<AttentionRule, number>;
  total: number;
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
  const items: AttentionItem[] = [];

  for (const l of loads) {
    if (isCancelledStatus(l.status) || isSettledLoad(l)) continue;
    const active = isActiveLoad(l, today);
    const where = route(l);
    const base = { loadId: l.id, loadLabel: label(l) };
    const edit = `/loads/${l.id}/edit`;

    if (active && includeDriverAssignment && !l.driver_id) {
      items.push({ ...base, rule: "no_driver", detail: where || "Route not set", href: `/loads/${l.id}` });
    }
    if (active && !l.delivery_date) {
      items.push({ ...base, rule: "no_delivery_date", detail: "Counted by pickup date until set", href: edit });
    }
    const s = normalizeLoadStatus(l.status);
    if (s && IN_MOTION.has(s) && l.delivery_date && l.delivery_date.slice(0, 10) < today) {
      items.push({
        ...base,
        rule: "status_behind_delivery",
        detail: `Delivery was ${l.delivery_date.slice(0, 10)} · status still ${loadStatusLabel(s)}`,
        href: edit,
      });
    }
    if (!l.total_revenue) {
      items.push({ ...base, rule: "no_rate", detail: where || "Revenue is empty", href: edit });
    }
    if (
      loadIdsWithRateConfirmation !== null &&
      isDeliveredLoad(l, today) &&
      !loadIdsWithRateConfirmation.has(l.id)
    ) {
      items.push({ ...base, rule: "no_rate_confirmation", detail: where || "Delivered", href: `/loads/${l.id}` });
    }
  }

  items.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));

  const countsByRule = Object.fromEntries(RULE_ORDER.map((r) => [r, 0])) as Record<AttentionRule, number>;
  for (const i of items) countsByRule[i.rule] += 1;

  return { items, countsByRule, total: items.length };
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
