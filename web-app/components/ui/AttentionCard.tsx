// AttentionCard — one actionable row in "Attention Required".
import Link from "next/link";
import { cx } from "./cx";

export default function AttentionCard({
  title,
  subject,
  detail,
  href,
  actionLabel,
  tone = "warning",
}: {
  title: string;
  subject: string;
  detail?: string;
  href: string;
  actionLabel: string;
  tone?: "warning" | "info";
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sp-gold"
    >
      <span
        aria-hidden
        className={cx(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          tone === "warning" ? "bg-sp-warning" : "bg-sky-400",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-sp-textPrimary">
          {subject} <span className="text-sp-textSecondary">· {title}</span>
        </span>
        {detail && <span className="mt-0.5 block break-words text-xs text-sp-textSecondary">{detail}</span>}
        <span aria-hidden className="mt-1.5 block text-xs font-semibold text-sp-gold sm:hidden">
          {actionLabel} →
        </span>
      </span>
      <span className="hidden shrink-0 self-center text-xs font-semibold text-sp-gold group-hover:text-sp-goldLight sm:inline">
        {actionLabel} <span aria-hidden>→</span>
      </span>
    </Link>
  );
}
