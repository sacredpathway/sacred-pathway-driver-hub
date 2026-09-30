// SectionCard — titled panel used to group a dashboard/page section.
import type { ReactNode } from "react";
import { cx } from "./cx";

export default function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  headingLevel = 2,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx("rounded-2xl border border-white/[0.06] bg-sp-card/80 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <H id={headingId} className="text-sm font-semibold tracking-tight text-sp-textPrimary">
            {title}
          </H>
          {description && <p className="mt-0.5 text-xs text-sp-textSecondary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cx("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}
