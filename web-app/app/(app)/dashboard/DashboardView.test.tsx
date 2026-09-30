import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveRange } from "@/lib/reports/range";
import { computeDashboardKpis } from "@/lib/dashboard/kpis";
import { attentionItems } from "@/lib/dashboard/attention";
import DashboardView, { type DashboardViewProps } from "./DashboardView";

function props(over: Partial<DashboardViewProps> = {}): DashboardViewProps {
  const thisWeek = resolveRange({ preset: "this_week" });
  return {
    range: resolveRange({ preset: "all_time" }),
    thisWeek,
    isCarrierAdmin: true,
    driverNeedsLink: false,
    loadsError: false,
    kpis: computeDashboardKpis({ allLoads: [], periodLoads: [], periodExpenses: [], thisWeek, today: "2026-09-30" }),
    activeDrivers: { active: 0, total: 0 },
    attention: attentionItems({ loads: [], today: "2026-09-30", includeDriverAssignment: true, loadIdsWithRateConfirmation: new Set() }),
    operations: { rows: [], totalActive: 0 },
    showDriverColumn: true,
    settlements: { rows: [], error: false },
    activity: [],
    ...over,
  };
}

describe("DashboardView with no data", () => {
  const html = renderToStaticMarkup(<DashboardView {...props()} />);

  it("shows the polished empty settlement state, not sample rows", () => {
    expect(html).toContain("No settlements yet");
    expect(html).not.toMatch(/SP-\d{4}-\d{4}/);
  });

  it("shows zeros, not invented numbers", () => {
    expect(html).toContain("$0.00");
    const dollarAmounts = (html.match(/\$[\d,]+\.\d{2}/g) ?? []).filter((m) => m !== "$0.00");
    expect(dollarAmounts).toEqual([]);
  });

  it("states that nothing needs attention instead of inventing alerts", () => {
    expect(html).toContain("Nothing needs attention");
  });

  it("offers only working quick actions — no Create Settlement", () => {
    for (const href of ["/loads/new", "/drivers/new", "/documents#upload", "/expenses/new"]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toMatch(/settlements\/new|Create settlement/i);
  });
});

describe("DashboardView role and error states", () => {
  it("driver view hides admin-only actions, settlements and driver column", () => {
    const html = renderToStaticMarkup(
      <DashboardView {...props({ isCarrierAdmin: false, activeDrivers: null, settlements: null, activity: null, showDriverColumn: false })} />,
    );
    expect(html).not.toContain('href="/loads/new"');
    expect(html).not.toContain('href="/drivers/new"');
    expect(html).not.toContain("Recent settlements");
    expect(html).toContain('href="/expenses/new"');
  });

  it("a failed settlements read shows an error, not an empty or fake list", () => {
    const html = renderToStaticMarkup(<DashboardView {...props({ settlements: { rows: [], error: true } })} />);
    expect(html).toContain("Settlements couldn&#x27;t be loaded");
    expect(html).not.toContain("No settlements yet");
  });
});
