"use client";
// Mobile / tablet navigation (below lg): compact sticky header + slide-in
// drawer. Accessible dialog: focus moves into the drawer, Escape/backdrop/
// close button/route change all close it, focus returns to the menu button,
// and the page behind does not scroll while it is open.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { Menu, X } from "lucide-react";
import {
  navContextForPath,
  primaryActionForPath,
  type AppAccessLevel,
} from "@/lib/nav/config";
import { initialMobileNavState, mobileNavReducer } from "@/lib/nav/mobileNav";
import { buttonClasses } from "@/components/ui/Button";
import BrandMark from "./BrandMark";
import NavList from "./NavList";
import AccountPanel from "./AccountPanel";

export default function MobileNavigation({
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
  const pathname = usePathname();
  const [state, dispatch] = useReducer(mobileNavReducer, pathname, initialMobileNavState);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => dispatch({ type: "route_change", pathname }), [pathname]);

  useEffect(() => {
    if (state.open) {
      wasOpen.current = true;
      closeButton.current?.focus();
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") dispatch({ type: "escape" });
      };
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = prev;
        window.removeEventListener("keydown", onKey);
      };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      menuButton.current?.focus();
    }
  }, [state.open]);

  const ctx = navContextForPath(pathname);
  const action = primaryActionForPath(pathname, accessLevel);

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/[0.06] bg-sp-background/95 px-3 backdrop-blur lg:hidden print:hidden">
        <button
          ref={menuButton}
          type="button"
          onClick={() => dispatch({ type: "toggle" })}
          aria-expanded={state.open}
          aria-controls="mobile-nav-drawer"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sp-textPrimary hover:bg-white/[0.06]"
        >
          <Menu aria-hidden className="h-5 w-5" />
          <span className="sr-only">Open navigation</span>
        </button>
        <Link href="/dashboard" className="min-w-0 flex-1 truncate rounded-lg" aria-label="Dashboard">
          <span className="block truncate text-sm font-semibold text-sp-textPrimary">
            {ctx?.item.label ?? "Driver Hub"}
          </span>
          <span className="block truncate text-[11px] text-sp-textSecondary">
            {companyName?.trim() || "Sacred Pathway Driver Hub"}
          </span>
        </Link>
        {action && (
          <Link href={action.href} className={buttonClasses("primary", "sm", "h-10 px-3")}>
            {action.label}
          </Link>
        )}
      </div>

      {state.open && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => dispatch({ type: "close" })}
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
          />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-white/[0.08] bg-sp-background shadow-2xl"
          >
            <div className="flex h-16 items-center justify-between gap-2 border-b border-white/[0.06] px-4">
              <BrandMark companyName={companyName} logoUrl={logoUrl} />
              <button
                ref={closeButton}
                type="button"
                onClick={() => dispatch({ type: "close" })}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sp-textPrimary hover:bg-white/[0.06]"
              >
                <X aria-hidden className="h-5 w-5" />
                <span className="sr-only">Close navigation</span>
              </button>
            </div>
            <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
              <NavList accessLevel={accessLevel} onNavigate={() => dispatch({ type: "close" })} />
            </nav>
            <div className="border-t border-white/[0.06] px-3 py-3">
              <AccountPanel email={email} accessLevel={accessLevel} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
