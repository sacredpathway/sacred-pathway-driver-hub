"use client";
// Desktop sidebar (lg and up). Collapsible to an icon rail; the preference is
// a per-browser convenience in localStorage (wrapped — storage can throw).
import Link from "next/link";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { AppAccessLevel } from "@/lib/nav/config";
import { cx } from "@/components/ui/cx";
import BrandMark from "./BrandMark";
import NavList from "./NavList";
import AccountPanel from "./AccountPanel";

const STORAGE_KEY = "sp.sidebar.collapsed";

export default function Sidebar({
  email,
  companyName,
  logoUrl,
  accessLevel,
}: {
  email?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  accessLevel?: AppAccessLevel;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      aria-label="Primary"
      className={cx(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-white/[0.06] bg-sp-black/60 transition-[width] duration-200 lg:flex print:hidden",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className={cx("flex h-16 items-center border-b border-white/[0.06]", collapsed ? "justify-center px-2" : "px-4")}>
        <Link href="/dashboard" className="min-w-0 rounded-lg" aria-label="Dashboard">
          <BrandMark companyName={companyName} logoUrl={logoUrl} compact={collapsed} />
        </Link>
      </div>

      <nav aria-label="Main navigation" className={cx("flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
        <NavList accessLevel={accessLevel} collapsed={collapsed} />
      </nav>

      <div className={cx("space-y-3 border-t border-white/[0.06] py-3", collapsed ? "px-2" : "px-3")}>
        <AccountPanel email={email} accessLevel={accessLevel} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          className={cx(
            "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs font-medium text-sp-textSecondary transition-colors hover:bg-white/[0.05] hover:text-sp-textPrimary",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="h-4 w-4" />
          ) : (
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          )}
          <span className={cx(collapsed && "sr-only")}>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
        </button>
      </div>
    </aside>
  );
}
