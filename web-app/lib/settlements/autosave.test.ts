import { describe, expect, it } from "vitest";
import { applyRowIdMap, mintNewRowIds, rowIdMap } from "./payload";
import type { SettlementBundle } from "./model";

// Autosave saves the same editor state many times. The server mints new ids
// for lines it hasn't seen; the editor must adopt them or the next autosave
// would insert those lines a second time.

const A = "00000000-0000-4000-8000-0000000000a1";
const D = "00000000-0000-4000-8000-0000000000d1";

function bundle(): SettlementBundle {
  const add = (id: string) => ({ id, category: "bonus", customCategoryId: null, description: "Bonus", amount: "50", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null });
  const ded = (id: string) => ({ id, category: "fuel", customCategoryId: null, description: "Fuel", amount: "100", responsibility: "driver", driverSharePercent: "100" });
  return {
    header: { id: "33333333-3333-4333-8333-333333333333" },
    loadLines: [],
    additions: [add(A), add("browser-new-1")],
    deductions: [ded(D), ded("browser-new-2")],
  } as unknown as SettlementBundle;
}

describe("autosave row ids", () => {
  it("maps only NEW lines to the ids the server stored", () => {
    const prev = bundle();
    prev.additions = prev.additions.slice(0, 1);
    prev.deductions = prev.deductions.slice(0, 1);
    const cleaned = bundle();
    const before = { ...cleaned, additions: [...cleaned.additions], deductions: [...cleaned.deductions] };
    mintNewRowIds(prev, cleaned);
    const map = rowIdMap(before, cleaned);
    expect(Object.keys(map).sort()).toEqual(["browser-new-1", "browser-new-2"]);
    expect(map[A]).toBeUndefined();
    expect(map[D]).toBeUndefined();

    const editor = applyRowIdMap(bundle(), map);
    expect(editor.additions.map((x) => x.id)).toEqual([A, map["browser-new-1"]]);
    expect(editor.deductions.map((x) => x.id)).toEqual([D, map["browser-new-2"]]);

    // Second autosave: every line is now known, so nothing is new again.
    const prev2 = cleaned;
    const again = applyRowIdMap(bundle(), map);
    const before2 = { ...again, additions: [...again.additions], deductions: [...again.deductions] };
    mintNewRowIds(prev2, again);
    expect(rowIdMap(before2, again)).toEqual({});
  });

  it("no map → same object (no re-render churn)", () => {
    const b = bundle();
    expect(applyRowIdMap(b, {})).toBe(b);
  });
});
