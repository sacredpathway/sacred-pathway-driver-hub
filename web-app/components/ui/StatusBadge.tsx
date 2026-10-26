// StatusBadge — the one visual for a stored load status.
// Label + tone both come from lib/loads/status (Phase 0.5 canonical
// vocabulary). This component never decides a label itself, and it is
// display-only: what the web may WRITE is still gated by
// WRITABLE_LOAD_STATUSES / isAllowedStatusWrite.

import { loadStatusLabel, loadStatusTone, normalizeLoadStatus, type LoadStatusTone } from "@/lib/loads/status";
import { cx } from "./cx";

export type BadgeTone = LoadStatusTone | "info" | "success" | "danger" | "gold" | "neutral";

export const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-white/[0.06] text-sp-textSecondary ring-white/10",
  info: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  progress: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
  success: "bg-sp-success/10 text-emerald-300 ring-sp-success/30",
  gold: "bg-sp-gold/10 text-sp-goldLight ring-sp-gold/30",
  settled: "bg-emerald-400/5 text-emerald-200/80 ring-emerald-300/20",
  danger: "bg-sp-danger/10 text-red-300 ring-sp-danger/30",
  unknown: "bg-sp-warning/10 text-orange-300 ring-sp-warning/30",
};

export function Badge({
  tone,
  children,
  className,
  title,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        BADGE_TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

export default function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const label = loadStatusLabel(status);
  const raw = normalizeLoadStatus(status);
  return (
    <Badge
      tone={loadStatusTone(status)}
      className={className}
      // Stored value in the tooltip so "pending" vs "unassigned" stays inspectable.
      title={raw ? `Status: ${label} (${raw})` : "Status not set"}
    >
      {label === "—" ? "Not set" : label}
    </Badge>
  );
}
