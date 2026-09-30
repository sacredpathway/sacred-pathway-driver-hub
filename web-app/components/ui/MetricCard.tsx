// MetricCard — one KPI. Server-rendered, no JS.
// The full value is always in the DOM (and in `title`), so a long currency
// figure is never lost to truncation; the value wraps instead of clipping.
import type { ReactNode } from "react";
import { cx } from "./cx";

export type MetricTone = "neutral" | "gold" | "good" | "bad";

const TONE: Record<MetricTone, string> = {
  neutral: "text-sp-textPrimary",
  gold: "text-sp-gold",
  good: "text-emerald-300",
  bad: "text-red-300",
};

export default function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  footer,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: MetricTone;
  icon?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-white/[0.06] bg-sp-card/80 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sp-textSecondary">{label}</p>
        {icon && <span aria-hidden className="text-sp-textSecondary">{icon}</span>}
      </div>
      <p
        title={value}
        className={cx("mt-2 break-words text-xl font-bold tabular-nums tracking-tight sm:text-2xl 2xl:text-[26px]", TONE[tone])}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs leading-snug text-sp-textSecondary">{hint}</p>}
      {footer && <div className="mt-3 border-t border-white/[0.06] pt-2 text-xs text-sp-textSecondary">{footer}</div>}
    </div>
  );
}
