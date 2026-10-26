import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmptyState from "@/components/EmptyState";
import MetricCard from "./MetricCard";
import SectionCard from "./SectionCard";
import DataTable from "./DataTable";
import { buttonClasses } from "./Button";

describe("shared UI primitives", () => {
  it("EmptyState keeps its pre-Phase-A API (title/body/cta)", () => {
    const html = renderToStaticMarkup(<EmptyState title="No loads yet" body="Add one" cta={<a href="/x">Go</a>} />);
    expect(html).toContain("No loads yet");
    expect(html).toContain("Add one");
    expect(html).toContain('href="/x"');
  });

  it("MetricCard exposes the full value (no information lost to truncation)", () => {
    const html = renderToStaticMarkup(<MetricCard label="Gross revenue" value="$1,234,567.89" />);
    expect(html).toContain('title="$1,234,567.89"');
    expect(html).not.toContain("truncate");
  });

  it("SectionCard labels its region by its heading", () => {
    const html = renderToStaticMarkup(<SectionCard id="ops" title="Operations overview">x</SectionCard>);
    expect(html).toContain('aria-labelledby="ops-title"');
    expect(html).toContain('<h2 id="ops-title"');
  });

  it("DataTable renders a captioned table and mobile cards from one spec", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Active loads"
        rows={[{ id: "1", n: "L-100", r: "$5.00" }]}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "Load", primary: true, cell: (r) => r.n },
          { key: "r", header: "Rate", align: "right", cell: (r) => r.r },
        ]}
      />,
    );
    expect(html).toContain('<caption class="sr-only">Active loads</caption>');
    expect(html).toContain('scope="col"');
    expect(html.match(/L-100/g)).toHaveLength(2); // table + card
    expect(html).toContain("<dt");
  });

  it("buttons keep a 40px touch target at the default size", () => {
    expect(buttonClasses()).toContain("h-10");
    expect(buttonClasses("primary")).toContain("bg-sp-gold");
  });
});
