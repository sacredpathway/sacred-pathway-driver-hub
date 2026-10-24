import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAV_SECTIONS,
  allNavItems,
  isNavItemActive,
  navContextForPath,
  primaryActionForPath,
  visibleNavSections,
} from "./config";

const ROOT = join(__dirname, "..", "..");
const pageExists = (href: string) =>
  existsSync(join(ROOT, "app", "(app)", ...href.split("#")[0].split("/").filter(Boolean), "page.tsx"));

describe("navigation destinations", () => {
  it("every nav item is an existing page (no dead links)", () => {
    for (const item of allNavItems()) expect(pageExists(item.href), item.href).toBe(true);
  });

  it("every primary action points at an existing page", () => {
    for (const item of allNavItems()) {
      if (item.primaryAction) expect(pageExists(item.primaryAction.href), item.primaryAction.href).toBe(true);
    }
  });

  it("every nav item is protected by middleware", () => {
    const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
    for (const item of allNavItems()) expect(mw).toContain(`"${item.href}"`);
  });

  it("keeps every destination the old top nav had", () => {
    const hrefs = allNavItems().map((i) => i.href).sort();
    expect(hrefs).toEqual(
      [
        "/dashboard", "/loads", "/drivers", "/team", "/payroll", "/settlements", "/fleet",
        "/brokers", "/broker-contacts", "/expenses", "/documents", "/reports", "/settings",
      ].sort(),
    );
  });

  // Phase D (web settlements, owner-approved 2026-10): the iPhone settlement
  // model is the live payroll system on web, so "New settlement" now exists —
  // as a carrier-admin action only, never a driver destination.
  it("'New settlement' is a carrier-admin primary action on Settlements (Phase D)", () => {
    const settlements = allNavItems().find((i) => i.href === "/settlements");
    expect(settlements?.primaryAction).toEqual({ href: "/settlements/new", label: "New settlement", visibleTo: "carrier_admin" });
    const others = allNavItems().filter((i) => i.href !== "/settlements").flatMap((i) => [i.href, i.primaryAction?.href ?? ""]);
    expect(others.some((h) => /settlements\/new/.test(h))).toBe(false);
  });

  it("section ids are unique and hrefs are unique", () => {
    expect(new Set(NAV_SECTIONS.map((s) => s.id)).size).toBe(NAV_SECTIONS.length);
    const hrefs = allNavItems().map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("visibility by access level (unchanged rules)", () => {
  const hrefsFor = (lvl: Parameters<typeof visibleNavSections>[0]) =>
    visibleNavSections(lvl).flatMap((s) => s.items.map((i) => i.href));

  it("carrier admin sees everything", () => {
    expect(hrefsFor("carrier_admin")).toHaveLength(allNavItems().length);
  });

  it("drivers do not see admin surfaces", () => {
    for (const lvl of ["carrier_driver", "basic_driver", "free"] as const) {
      const h = hrefsFor(lvl);
      for (const admin of ["/drivers", "/team", "/fleet", "/brokers", "/broker-contacts"]) expect(h).not.toContain(admin);
      for (const shared of ["/dashboard", "/loads", "/settlements", "/payroll", "/expenses", "/documents", "/reports", "/settings"]) {
        expect(h).toContain(shared);
      }
    }
  });

  it("drops sections left empty", () => {
    for (const s of visibleNavSections("carrier_driver")) expect(s.items.length).toBeGreaterThan(0);
  });
});

describe("active state", () => {
  it("matches the item and nested routes only", () => {
    expect(isNavItemActive("/loads", "/loads")).toBe(true);
    expect(isNavItemActive("/loads/123/edit", "/loads")).toBe(true);
    expect(isNavItemActive("/loads/", "/loads")).toBe(true);
    expect(isNavItemActive("/loads?x=1", "/loads")).toBe(true);
    expect(isNavItemActive("/loadsx", "/loads")).toBe(false);
    expect(isNavItemActive("/broker-contacts", "/brokers")).toBe(false);
    expect(isNavItemActive(null, "/loads")).toBe(false);
  });

  it("resolves the owning item + section for the top bar", () => {
    expect(navContextForPath("/broker-contacts/1")?.item.label).toBe("Broker Contacts");
    expect(navContextForPath("/reports/cpa")?.section.label).toBe("Finance");
    expect(navContextForPath("/nowhere")).toBeNull();
  });
});

describe("mobile primary action", () => {
  it("only on the section index, only when allowed", () => {
    expect(primaryActionForPath("/loads", "carrier_admin")?.href).toBe("/loads/new");
    expect(primaryActionForPath("/loads/new", "carrier_admin")).toBeNull();
    expect(primaryActionForPath("/loads/abc", "carrier_admin")).toBeNull();
    expect(primaryActionForPath("/loads", "carrier_driver")).toBeNull();
    expect(primaryActionForPath("/expenses", "carrier_driver")?.href).toBe("/expenses/new");
    expect(primaryActionForPath("/drivers", "carrier_driver")).toBeNull();
    expect(primaryActionForPath("/dashboard", "carrier_admin")).toBeNull();
  });
});
