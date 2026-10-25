// Which website uploads never finished reading (tab closed, network drop,
// crash) and should be resumed automatically when the Documents page opens.
import { STALE_PROCESSING_MS } from "./pipeline";

export interface ResumableDoc {
  id: string;
  source?: string | null;
  status?: string | null;
  review_status?: string | null;
  duplicate_of?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function resumeCandidates(docs: readonly ResumableDoc[], nowMs: number = Date.now(), limit = 10): string[] {
  const staleBefore = nowMs - STALE_PROCESSING_MS;
  return docs
    .filter((d) => d.source === "web" && d.review_status == null && !d.duplicate_of && (
      (d.status === "pending" && Date.parse(d.created_at ?? "") < nowMs - 60_000) ||
      (d.status === "processing" && Date.parse(d.updated_at ?? d.created_at ?? "") < staleBefore)))
    .slice(0, limit)
    .map((d) => d.id);
}
