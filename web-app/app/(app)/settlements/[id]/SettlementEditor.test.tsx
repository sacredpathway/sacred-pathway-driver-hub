// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { saveSettlementAction } from "../actions";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("../actions", () => ({
  saveSettlementAction: vi.fn(), transitionSettlementAction: vi.fn(), createCustomCategoryAction: vi.fn(),
}));

import SettlementEditor, { type EditorProps } from "./SettlementEditor";
import { NO_FEES, type SettlementBundle } from "@/lib/settlements/model";
import { lineFromLoad } from "@/lib/settlements/workflow";

const P = "11111111-2222-4333-8444-555555555555";

function bundle(status: SettlementBundle["header"]["status"]): SettlementBundle {
  return {
    header: {
      id: "33333333-3333-4333-8333-333333333333", profileId: P, driverId: "22222222-2222-4222-8222-222222222222",
      periodStart: "2026-10-12", periodEnd: "2026-10-18", status, settlementNumber: "SP-2026-0007",
      settlementType: "company_driver", truckNumber: "12",
      payRule: { components: [{ id: "00000000-0000-4000-8000-000000000001", kind: "percent_of_gross", label: "Percentage of Gross", percent: "27.5", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }], feeTerms: { ...NO_FEES, factoringFeePercent: "2.5" } },
      payOnGrossRevenue: true, hoursWorked: null, notes: null, paymentMethod: null, paymentReference: null,
      driverPayPercentage: 27.5, netPay: 890.44, isEstimate: false, engineVersion: "settlement-engine/1.0",
      createdAt: null, updatedAt: "2026-10-19T10:00:00+00:00", approvedAt: null, approvedBy: null, paidAt: null, voidedAt: null, createdBy: P,
    },
    loadLines: [lineFromLoad({ id: "00000000-0000-4000-8000-000000000050", driver_id: null, load_number: "45122", broker_name: "TQL", broker_mc_number: null, pickup_date: "2026-10-13", delivery_date: "2026-10-15", origin: "Dallas, TX", destination: "Phoenix, AZ", total_miles: 1065, empty_miles: 0, line_haul_rate: 2850.55, fuel_surcharge: 312.4, accessorial_charges: 75, total_revenue: 3237.95, status: "settled" }, 0)],
    additions: [{ id: "00000000-0000-4000-8000-000000000080", category: "other", customCategoryId: "00000000-0000-4000-8000-000000000081", description: "ELD reimbursement", amount: "19.99", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null }],
    deductions: [],
  };
}

const props = (status: SettlementBundle["header"]["status"], canEdit = true): EditorProps => ({
  initial: bundle(status), updatedAt: "2026-10-19T10:00:00+00:00", driverName: "Marcus Lee", canEdit,
  customs: { available: true, categories: [{ id: "00000000-0000-4000-8000-000000000081", kind: "addition", name: "ELD reimbursement", baseCategory: "other", defaultResponsibility: "driver", defaultDriverSharePercent: "100", isArchived: false }], suggestions: { addition: [], deduction: [] } },
  eligible: [], rules: [], otherNumbers: [], alreadyPaid: [], auditTrail: [{ id: "e1", action: "created", summary: "Settlement created for Marcus Lee", actor_name: "owner@example.com", timestamp: "2026-10-19T10:00:00Z" }],
});

describe("SettlementEditor", () => {
  it("draft: editable, live exact net pay, custom category shown, finalize available", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("draft")} />);
    // 27.5% × 3,237.95 = 890.44 + 19.99 addition = 910.43 (factoring is company-paid)
    expect(html).toContain("$910.43");
    expect(html).toContain("Factoring Fee (2.5%)");
    expect(html).toContain("ELD reimbursement");
    expect(html).toContain("Finalize (approve)");
    expect(html).toContain("+ Add deduction");
    expect(html).toContain("Settlement created for Marcus Lee");
    expect(html).not.toContain("locked");
    expect(html).toContain("Autosave on");
  });

  it("approved: locked read-only with reopen + mark paid, no add buttons", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("approved")} />);
    expect(html).toContain("approved and locked");
    expect(html).toContain("Reopen to edit");
    expect(html).toContain("Mark paid");
    expect(html).not.toContain("+ Add deduction");
    expect(html).not.toContain("Save changes");
    expect(html).not.toContain("Autosave on");
  });

  it("paid: reopen goes back to approved; voided: reopen as draft", () => {
    expect(renderToStaticMarkup(<SettlementEditor {...props("paid")} />)).toContain("Reopen (back to approved)");
    const v = renderToStaticMarkup(<SettlementEditor {...props("voided")} />);
    expect(v).toContain("This settlement is voided.");
    expect(v).not.toContain("Void…");
  });

  it("non-owner: view only, no status actions", () => {
    const html = renderToStaticMarkup(<SettlementEditor {...props("draft", false)} />);
    expect(html).toContain("View only");
    expect(html).not.toContain("Finalize (approve)");
  });
});


describe("SettlementEditor browser autosave", () => {
  let host: HTMLDivElement;
  let root: Root;
  const backupKey = "sph.settlementDraft.v1.33333333-3333-4333-8333-333333333333";
  const saveAction = vi.mocked(saveSettlementAction);
  const saved = (idMap = {}) => ({ ok: true as const, updatedAt: "2026-10-19T11:00:00Z", netPay: "910.43", idMap });
  const mount = async (p = props("draft")) => { await act(async () => { root.render(<SettlementEditor {...p} />); }); };
  const tick = async (ms = 2500) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
    expect(button).toBeDefined();
    await act(async () => { button.click(); });
  };
  const notes = async (value: string) => {
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!;
    await act(async () => { input.value = value; Simulate.change(input); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    saveAction.mockReset();
    saveAction.mockResolvedValue(saved());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a stale backup across opening the editor and restores it only on request", async () => {
    const initialProps = props("draft");
    const draft = structuredClone(initialProps.initial);
    draft.header.notes = "Recovered work";
    localStorage.setItem(backupKey, JSON.stringify({ base: "older-version", at: Date.now(), bundle: draft }));
    await mount(initialProps);
    expect(host.textContent).toContain("Restore my edits");
    expect(host.textContent).toContain("changed elsewhere");
    expect(localStorage.getItem(backupKey)).toContain("Recovered work");
    await tick();
    expect(saveAction).not.toHaveBeenCalled();
    await click("Restore my edits");
    await tick();
    expect(saveAction.mock.calls[0][2].header.notes).toBe("Recovered work");
    expect(localStorage.getItem(backupKey)).toBeNull();
  });

  it("debounces edits, saves the latest notes, and clears the backup on success", async () => {
    await mount();
    await notes("first");
    await tick(2000);
    await notes("latest");
    await tick(2499);
    expect(saveAction).not.toHaveBeenCalled();
    expect(localStorage.getItem(backupKey)).toContain("latest");
    await tick(1);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(saveAction.mock.calls[0][2].header.notes).toBe("latest");
    expect(host.textContent).toContain("all changes saved");
    expect(localStorage.getItem(backupKey)).toBeNull();
  });

  it("adopts server ids before saving edits made while the first save was pending", async () => {
    let finish!: (r: Awaited<ReturnType<typeof saveSettlementAction>>) => void;
    saveAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await click("+ Add addition");
    await tick();
    const browserId = saveAction.mock.calls[0][2].additions[1].id;
    await notes("typed during save");
    await tick();
    expect(saveAction).toHaveBeenCalledTimes(1);
    const serverId = "00000000-0000-4000-8000-000000000099";
    await act(async () => { finish(saved({ [browserId]: serverId })); });
    await tick();
    expect(saveAction).toHaveBeenCalledTimes(2);
    expect(saveAction.mock.calls[1][1]).toBe("2026-10-19T11:00:00Z");
    expect(saveAction.mock.calls[1][2].additions[1].id).toBe(serverId);
    expect(saveAction.mock.calls[1][2].header.notes).toBe("typed during save");
  });

  it("updates backup ids after an in-flight save finishes following navigation", async () => {
    let finish!: (r: Awaited<ReturnType<typeof saveSettlementAction>>) => void;
    saveAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await click("+ Add addition");
    await tick();
    const browserId = saveAction.mock.calls[0][2].additions[1].id;
    await notes("leave before save finishes");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    const serverId = "00000000-0000-4000-8000-000000000099";
    await act(async () => { finish(saved({ [browserId]: serverId })); });
    const backup = JSON.parse(localStorage.getItem(backupKey)!);
    expect(backup.base).toBe("2026-10-19T11:00:00Z");
    expect(backup.bundle.additions[1].id).toBe(serverId);
    expect(backup.bundle.header.notes).toBe("leave before save finishes");
  });

  it("retries a network failure without needing another edit", async () => {
    saveAction.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await notes("offline work");
    await tick();
    expect(localStorage.getItem(backupKey)).toContain("offline work");
    expect(host.textContent).toContain("Couldn't save");
    await tick();
    expect(saveAction).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(backupKey)).toBeNull();
  });

  it("pauses on a version conflict and retains local edits", async () => {
    saveAction.mockResolvedValueOnce({ ok: false, error: "This settlement changed somewhere else." });
    await mount();
    await notes("my edits");
    await tick();
    expect(host.textContent).toContain("Reload latest");
    await tick(10000);
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(backupKey)).toContain("my edits");
  });

  it("preserves unsaved work when a server refresh brings another device's version", async () => {
    await mount();
    await notes("local notes");
    const next = props("draft");
    next.updatedAt = "2026-10-19T12:00:00Z";
    next.initial.header.notes = "remote notes";
    await mount(next);
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!.value).toBe("local notes");
    expect(host.textContent).toContain("Reload latest");
    await tick();
    expect(saveAction).not.toHaveBeenCalled();
    expect(localStorage.getItem(backupKey)).toContain("local notes");
  });

  it("flushes pending edits on pagehide", async () => {
    await mount();
    await notes("leaving");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(saveAction.mock.calls[0][2].header.notes).toBe("leaving");
  });

  it.each(["approved", "paid", "voided"] as const)("never autosaves %s settlements", async (status) => {
    await mount(props(status));
    await tick();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(saveAction).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="autosave-status"]')).toBeNull();
  });
});
