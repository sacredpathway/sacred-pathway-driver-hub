// EmptyState — shared "nothing here yet" panel. Same props as before Phase A
// (title / body / cta) so every existing page keeps working; `icon` and
// `compact` are optional additions.
import type { ReactNode } from "react";

export default function EmptyState({
  title,
  body,
  cta,
  icon,
  compact = false,
}: {
  title: string;
  body?: ReactNode;
  cta?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center " +
        (compact ? "px-5 py-7" : "px-6 py-10")
      }
    >
      {icon && (
        <div aria-hidden className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-sp-gold/10 text-sp-gold">
          {icon}
        </div>
      )}
      <div className="text-base font-semibold text-sp-textPrimary">{title}</div>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-sp-textSecondary">{body}</p>}
      {cta && <div className="mt-4 flex flex-wrap justify-center gap-2">{cta}</div>}
    </div>
  );
}
