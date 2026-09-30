import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveRange } from "@/lib/reports/range";
import { computeDashboardKpis } from "@/lib/dashboard/kpis";
import { attentionItems } from "@/lib/dashboard/attention";
import DashboardView, { type DashboardViewProps } from "./DashboardView";

function props(over: Partial<DashboardViewProps> = {}): DashboardViewProps {
  return {
    range: resolveRange({ preset: "all_time" }),
    isCarrierAdmin: true,
    driverNeedsLink: false,
    loadsError: false,
    kpis: computeDashboardKpis({ periodLoads: [], periodExpenses: [] }),
    activeDrivers: { active: 0, total: 0 },
    attention: attentionItems({ loads: [], today: "2026-09-30", includeDriverAssignment: true, loadIdsWithRateConfirmation: new Set() }),
    operations: { rows: [], total: 0 },
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

  it("states that paperwork is complete instead of inventing alerts", () => {
    expect(html).toContain("Missing paperwork info");
    expect(html).toContain("has its rate, miles, driver, delivery date and rate confirmation");
  });

  it("shows no pickup/drop-off status anywhere on the dashboard", () => {
    expect(html).not.toMatch(/Active loads|Delivered this week|In Transit|Picked Up/);
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

describe("Recent loads row", () => {
  it("shows paperwork fields and never the load status", () => {
    const load = {
      id: "l1", load_number: "SP-1", driver_id: "d1", broker_name: "Acme", origin: "Tulsa, OK", destination: "Dallas, TX",
      pickup_date: "2026-09-28", delivery_date: "2026-09-29", status: "in_transit", total_revenue: 1234.5, total_miles: 480,
      created_at: "2026-09-28T00:00:00Z",
    };
    const html = renderToStaticMarkup(
      <DashboardView {...props({ operations: { rows: [{ load, driverName: "Pat" }], total: 1 } })} />,
    );
    expect(html).toContain("SP-1");
    expect(html).toContain("$1,234.50");
    expect(html).toContain("480");
    expect(html).not.toContain("In Transit");
  });
});
