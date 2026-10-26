"use client";
// Grouped nav links shared by the desktop Sidebar and the mobile drawer.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, visibleNavSections, type AppAccessLevel } from "@/lib/nav/config";
import { cx } from "@/components/ui/cx";
import { NAV_ICONS } from "./icons";

export default function NavList({
  accessLevel,
  collapsed = false,
  onNavigate,
}: {
  accessLevel?: AppAccessLevel;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = visibleNavSections(accessLevel);
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <div key={section.id}>
          {section.label && (
            <p
              className={cx(
                "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sp-textSecondary",
                collapsed && "sr-only",
              )}
            >
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              const Icon = NAV_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      "group relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sp-gold/[0.12] text-sp-gold"
                        : "text-sp-textSecondary hover:bg-white/[0.05] hover:text-sp-textPrimary",
                    )}
                  >
                    {active && (
                      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-sp-gold" />
                    )}
                    <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                    <span className={cx("truncate", collapsed && "sr-only")}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
