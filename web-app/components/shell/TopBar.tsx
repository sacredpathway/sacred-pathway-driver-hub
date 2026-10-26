"use client";
// Desktop top bar (lg and up): where you are + whose account this is.
// No notifications, search or decorative controls — nothing that doesn't work.
import { usePathname } from "next/navigation";
import { navContextForPath } from "@/lib/nav/config";

export default function TopBar({ companyName }: { companyName?: string | null }) {
  const pathname = usePathname();
  const ctx = navContextForPath(pathname);
  return (
    <div className="sticky top-0 z-20 hidden h-14 items-center justify-between gap-4 border-b border-white/[0.06] bg-sp-background/90 px-8 backdrop-blur lg:flex print:hidden">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-2 text-sm">
          {ctx?.section.label && (
            <>
              <li className="text-sp-textSecondary">{ctx.section.label}</li>
              <li aria-hidden className="text-sp-textSecondary/50">/</li>
            </>
          )}
          <li aria-current="page" className="truncate font-medium text-sp-textPrimary">
            {ctx?.item.label ?? "Driver Hub"}
          </li>
        </ol>
      </nav>
      {companyName?.trim() && (
        <p className="truncate text-xs text-sp-textSecondary">
          <span className="text-sp-textSecondary">Account · </span>
          <span className="font-medium text-sp-textPrimary">{companyName}</span>
        </p>
      )}
    </div>
  );
}
