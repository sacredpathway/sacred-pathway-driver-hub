// =============================================================================
//  App navigation — the single source of truth for the authenticated shell
// -----------------------------------------------------------------------------
//  Phase A. Every destination here is an EXISTING, working route (see
//  middleware PROTECTED_PREFIXES). No placeholders, no "coming soon" links.
//
//  Visibility rules are carried over unchanged from the old top Nav:
//  carrier-admin-only surfaces (roster, team, fleet, brokers) are hidden
//  from driver-level users.
//
//  Pure data + pure functions — no React — so it is unit-testable and shared
//  by the desktop Sidebar, the MobileNavigation drawer and the TopBar.
// =============================================================================

export type AppAccessLevel = "free" | "basic_driver" | "carrier_driver" | "carrier_admin";
export type NavAudience = "any" | "carrier_admin";

/** Icon keys resolved to lucide-react components in components/shell/icons.ts. */
export type NavIconKey =
  | "dashboard" | "loads" | "drivers" | "fleet" | "brokers" | "contacts"
  | "settlements" | "payroll" | "expenses" | "reports" | "documents"
  | "team" | "settings";

export interface NavAction {
  href: string;
  label: string;
  visibleTo: NavAudience;
}

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  visibleTo: NavAudience;
  /** Contextual primary action surfaced in the mobile top bar on this section's index page. */
  primaryAction?: NavAction;
}

export interface NavSection {
  id: string;
  /** null = unlabeled group (Dashboard). */
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    id: "home",
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", visibleTo: "any" }],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        href: "/loads", label: "Loads", icon: "loads", visibleTo: "any",
        primaryAction: { href: "/loads/new", label: "New load", visibleTo: "carrier_admin" },
      },
      {
        href: "/drivers", label: "Drivers", icon: "drivers", visibleTo: "carrier_admin",
        primaryAction: { href: "/drivers/new", label: "Add driver", visibleTo: "carrier_admin" },
      },
      { href: "/fleet", label: "Fleet", icon: "fleet", visibleTo: "carrier_admin" },
      { href: "/brokers", label: "Brokers", icon: "brokers", visibleTo: "carrier_admin" },
      { href: "/broker-contacts", label: "Broker Contacts", icon: "contacts", visibleTo: "carrier_admin" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      {
        href: "/settlements", label: "Settlements", icon: "settlements", visibleTo: "any",
        primaryAction: { href: "/settlements/new", label: "New settlement", visibleTo: "carrier_admin" },
      },
      { href: "/payroll", label: "Payroll History", icon: "payroll", visibleTo: "any" },
      {
        href: "/expenses", label: "Expenses", icon: "expenses", visibleTo: "any",
        primaryAction: { href: "/expenses/new", label: "Record expense", visibleTo: "any" },
      },
      { href: "/reports", label: "Reports", icon: "reports", visibleTo: "any" },
    ],
  },
  {
    id: "records",
    label: "Records",
    items: [
      {
        href: "/documents", label: "Documents", icon: "documents", visibleTo: "any",
        primaryAction: { href: "/documents#upload", label: "Upload", visibleTo: "any" },
      },
    ],
  },
  {
    id: "company",
    label: "Company",
    items: [
      { href: "/team", label: "Team", icon: "team", visibleTo: "carrier_admin" },
      { href: "/settings", label: "Settings", icon: "settings", visibleTo: "any" },
    ],
  },
];

/** Same rule as the previous Nav: unknown access level is treated as admin (layout always resolves one). */
export function canSee(audience: NavAudience, accessLevel: AppAccessLevel | undefined): boolean {
  if (audience === "any") return true;
  return accessLevel === "carrier_admin" || accessLevel === undefined;
}

/** Sections filtered to what this user may see; empty sections are dropped. */
export function visibleNavSections(accessLevel: AppAccessLevel | undefined): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => canSee(i.visibleTo, accessLevel)),
  })).filter((s) => s.items.length > 0);
}

export function allNavItems(): NavItem[] {
  return NAV_SECTIONS.flatMap((s) => s.items);
}

/** Active when the path is the item or below it — "/loads" is active on "/loads/123/edit", never on "/loadsx". */
export function isNavItemActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return path === href || path.startsWith(href + "/");
}

/** The nav item (and its section) that owns a path, for the top bar title. */
export function navContextForPath(
  pathname: string | null | undefined,
): { item: NavItem; section: NavSection } | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (isNavItemActive(pathname, item.href)) return { item, section };
    }
  }
  return null;
}

/**
 * Primary action for the mobile top bar: only on a section's index page
 * (e.g. "/loads", not "/loads/new" or "/loads/123") and only when the user
 * may perform it.
 */
export function primaryActionForPath(
  pathname: string | null | undefined,
  accessLevel: AppAccessLevel | undefined,
): NavAction | null {
  const ctx = navContextForPath(pathname);
  if (!ctx?.item.primaryAction) return null;
  const path = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "");
  if (path !== ctx.item.href) return null;
  if (!canSee(ctx.item.visibleTo, accessLevel)) return null;
  const action = ctx.item.primaryAction;
  return canSee(action.visibleTo, accessLevel) ? action : null;
}
