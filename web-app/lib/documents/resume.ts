// What to finish automatically when the Documents page opens, after an
// interruption (tab closed, network drop, crash, deploy):
//   * website uploads never read, stuck "processing", or read but never filed;
//   * filed pay documents whose payroll step never ran.
// Both are re-run through the same idempotent actions as a fresh upload.
import { STALE_PROCESSING_MS } from "./pipeline";

export interface ResumableDoc {
  id: string;
  source?: string | null;
  status?: string | null;
  review_status?: string | null;
  duplicate_of?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  settlement_id?: string | null;
  routing?: unknown;
}

export function resumeCandidates(docs: readonly ResumableDoc[], nowMs: number = Date.now(), limit = 10): string[] {
  const staleBefore = nowMs - STALE_PROCESSING_MS;
  return docs
    .filter((d) => d.source === "web" && d.review_status == null && !d.duplicate_of && (
      (d.status === "pending" && Date.parse(d.created_at ?? "") < nowMs - 60_000) ||
      (d.status === "processed" && Date.parse(d.updated_at ?? d.created_at ?? "") < nowMs - 60_000) ||
      (d.status === "processing" && Date.parse(d.updated_at ?? d.created_at ?? "") < staleBefore)))
    .slice(0, limit)
    .map((d) => d.id);
}

const PAY_TYPES = new Set(["rate_confirmation", "fuel_receipt", "toll", "repair", "scale_ticket", "lumper_fee"]);

/** Filed pay documents (last 30 days) whose automatic payroll step never recorded an outcome. */
export function payrollResumeCandidates(docs: readonly ResumableDoc[], nowMs: number = Date.now(), limit = 10): string[] {
  return docs
    .filter((d) => {
      if (d.review_status !== "auto_routed" && d.review_status !== "approved") return false;
      if (d.settlement_id) return false;
      const r = (d.routing ?? {}) as { type?: unknown; autopay?: unknown; applied?: Array<{ applied_at?: string; undone_at?: string }> };
      if (r.autopay || typeof r.type !== "string" || !PAY_TYPES.has(r.type)) return false;
      const last = (r.applied ?? []).filter((a) => !a.undone_at).map((a) => Date.parse(a.applied_at ?? "")).filter(Number.isFinite);
      if (last.length === 0) return false;
      const at = Math.max(...last);
      return at < nowMs - 60_000 && at > nowMs - 30 * 86_400_000;
    })
    .slice(0, limit)
    .map((d) => d.id);
}
