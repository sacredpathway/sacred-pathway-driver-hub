import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KNOWN_LOAD_STATUSES, loadStatusLabel, loadStatusTone } from "@/lib/loads/status";
import StatusBadge, { BADGE_TONE_CLASSES } from "./StatusBadge";

describe("StatusBadge renders the canonical vocabulary", () => {
  it.each([...KNOWN_LOAD_STATUSES])("%s → canonical label + tone", (s) => {
    const html = renderToStaticMarkup(<StatusBadge status={s} />);
    expect(html).toContain(`>${loadStatusLabel(s)}</span>`);
    const tone = loadStatusTone(s);
    for (const cls of BADGE_TONE_CLASSES[tone].split(" ")) expect(html).toContain(cls);
  });

  it("folds 'canceled' into Cancelled with the danger tone", () => {
    const html = renderToStaticMarkup(<StatusBadge status="Canceled" />);
    expect(html).toContain(">Cancelled</span>");
    expect(loadStatusTone("canceled")).toBe("danger");
  });

  it("pending displays as Unassigned but keeps the stored value inspectable", () => {
    const html = renderToStaticMarkup(<StatusBadge status="pending" />);
    expect(html).toContain(">Unassigned</span>");
    expect(html).toContain("(pending)");
  });

  it("unknown values are shown, never dropped", () => {
    const html = renderToStaticMarkup(<StatusBadge status="on_hold" />);
    expect(html).toContain(">On Hold</span>");
    expect(loadStatusTone("on_hold")).toBe("unknown");
  });

  it("empty status reads 'Not set'", () => {
    expect(renderToStaticMarkup(<StatusBadge status={null} />)).toContain(">Not set</span>");
  });

  it("every status has a distinct tone from cancelled except cancelled itself", () => {
    for (const s of KNOWN_LOAD_STATUSES) {
      if (s !== "cancelled") expect(loadStatusTone(s)).not.toBe("danger");
    }
  });
});
