import { describe, expect, it } from "vitest";
import { planBackfill, readOnlyRepo } from "./backfill";
import { sanitizeExtraction } from "./extraction";
import { addDoc, addLoad, createFakeRepo, FUEL, newState, RATE_CON } from "./fakeRepo.test-helpers";

describe("pending-document backfill (dry run)", () => {
  it("never writes: every mutating repo method throws", async () => {
    const st = newState();
    const ro = readOnlyRepo(createFakeRepo(st));
    await expect(ro.saveRouting("x", "needs_review", {} as never, false)).rejects.toThrow(/dry-run/);
    await expect(ro.insertExpense("x", {} as never)).rejects.toThrow(/dry-run/);
    await expect(ro.invokeExtractor("x", null)).rejects.toThrow(/dry-run/);
  });

  it("uses real hashes for duplicates, previews only unique files, reports every required column", async () => {
    const st = newState();
    addLoad(st, { load_number: "RC-1001", broker_name: "TQL", pickup_date: "2026-09-28", delivery_date: "2026-09-30", total_revenue: 2400 });
    const legacy = (n: number) => addDoc(st, { source: null, status: "pending", storage_path: `p/${n}.jpg` });
    const a = legacy(1); // unique rate con
    const b = legacy(2); // fuel
    const c = legacy(3); // same bytes as b
    const d = legacy(4); // same SIZE as b in production terms, different bytes
    const web = addDoc(st, { source: "web", status: "pending" }); // never touched
    const before = structuredClone([...st.docs.values()]);

    const bytes: Record<string, string> = { [a.id]: "h-a", [b.id]: "h-b", [c.id]: "h-b", [d.id]: "h-d", [web.id]: "h-w" };
    const outputs: Record<string, unknown> = { [a.id]: RATE_CON(), [b.id]: FUEL(), [d.id]: { document_type: "other", confidence: "low" } };
    const previewed: string[] = [];
    const rows = await planBackfill(createFakeRepo(st), [...st.docs.values()], {
      hashDocument: async (doc) => bytes[doc.id] ?? null,
      previewExtract: async (doc) => {
        previewed.push(doc.id);
        return { ok: true, extracted: { ...sanitizeExtraction(outputs[doc.id]), parse_stage: "strict" } };
      },
    });

    expect(rows.map((r) => r.document_id)).toEqual([a.id, b.id, c.id, d.id]);
    expect(previewed).toEqual([a.id, b.id, d.id]); // duplicate c not sent to the model
    const byId = Object.fromEntries(rows.map((r) => [r.document_id, r]));
    expect(byId[c.id]).toMatchObject({ duplicate_of: b.id, duplicate_group_size: 2, proposed_action: "dismiss_duplicate", review_required: true });
    expect(byId[d.id].duplicate_of).toBeNull();
    expect(byId[a.id]).toMatchObject({ proposed_type: "Rate confirmation", proposed_action: "attach_load", review_required: true });
    expect(byId[a.id].match_confidence).toBeGreaterThanOrEqual(0.9);
    expect(byId[b.id]).toMatchObject({ proposed_action: "create_expense", review_required: true });
    for (const r of rows) {
      expect(Object.keys(r)).toEqual(expect.arrayContaining([
        "document_id", "sha256", "duplicate_of", "proposed_type", "extracted_fields", "classification_confidence",
        "proposed_match", "match_confidence", "proposed_action", "review_required",
      ]));
    }
    expect([...st.docs.values()]).toEqual(before); // nothing mutated
    expect(st.expenses).toHaveLength(0);
  });
});
