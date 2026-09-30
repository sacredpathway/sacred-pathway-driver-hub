// PageHeader — the h1 row for a page: title, optional eyebrow/subtitle, actions.
import type { ReactNode } from "react";

export default function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
}: {
  title: string;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sp-gold/90">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-sp-textPrimary sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-sp-textSecondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
