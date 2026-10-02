import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDoc,
  addLoad,
  createFakeRepo,
  newState,
  OWNER,
  RATE_CON,
  storeExtraction,
  type FakeState,
} from "@/lib/documents/fakeRepo.test-helpers";

// ---------------------------------------------------------------- mocks ----
let st: FakeState;
const inserted: Record<string, Record<string, unknown>[]> = {};
const lookups: { loadsOwnedVisible: Set<string> } = { loadsOwnedVisible: new Set() };

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/documents/repo", () => ({ createDocumentRepo: () => createFakeRepo(st) }));

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  let insertRow: Record<string, unknown> | null = null;
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "eq") filters[String(args[0])] = args[1];
    if (name === "insert") insertRow = args[0] as Record<string, unknown>;
    return b;
  };
  for (const m of ["select", "eq", "order", "limit", "in", "is", "or", "neq", "insert", "update", "delete"]) b[m] = chain(m);
  const result = () => {
    if (insertRow) {
      (inserted[table] ??= []).push(insertRow);
      return { data: { id: `${table}-new-1` }, error: null };
    }
    if (table === "loads") {
      const id = String(filters.id);
      return { data: lookups.loadsOwnedVisible.has(id) && filters.profile_id === OWNER ? { id } : null, error: null };
    }
    if (table === "documents" && "content_sha256" in filters) return { data: null, error: null };
    if (table === "documents" && "id" in filters) {
      const d = st.docs.get(String(filters.id));
      return { data: d ? { id: d.id, storage_path: d.storage_path, routing: d.routing } : null, error: null };
    }
    return { data: null, error: null };
  };
  b.maybeSingle = async () => result();
  b.single = async () => result();
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return b;
}

const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) },
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      remove: async () => ({ error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }),
    }),
  },
  from: (t: string) => builder(t),
  rpc: async () => ({ data: false, error: null }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase }));

import {
  createLoadFromDocumentAction,
  deleteDocumentAction,
  processDocumentAction,
  uploadDocumentsAction,
} from "./actions";

beforeEach(() => {
  st = newState();
  for (const k of Object.keys(inserted)) delete inserted[k];
  lookups.loadsOwnedVisible = new Set();
});

const pdf = (name: string, text: string) => new File([new TextEncoder().encode(text)], name, { type: "application/pdf" });

describe("website upload", () => {
  it("stores, inserts pending web rows with a hash and returns them for extraction", async () => {
    const fd = new FormData();
    fd.append("files", pdf("a.pdf", "%PDF-1.7 aaaa"));
    fd.append("files", pdf("b.pdf", "%PDF-1.7 bbbb"));
    const res = await uploadDocumentsAction(undefined, fd);
    expect(res).toMatchObject({ ok: true, uploaded: 2 });
    const rows = inserted.documents ?? [];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "pending", source: "web", profile_id: OWNER });
      expect(r.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    if (res.ok) expect(res.documents.map((d) => d.duplicateOf)).toEqual([null, null]);
  });

  it("refuses a load id that isn't in the signed-in account", async () => {
    const fd = new FormData();
    fd.append("files", pdf("a.pdf", "%PDF-1.7 aaaa"));
    fd.append("load_id", "cccccccc-0000-4000-8000-000000000009");
    expect(await uploadDocumentsAction(undefined, fd)).toMatchObject({ ok: false, field: "load_id" });
    expect(inserted.documents).toBeUndefined();
  });

  it("rejects an unknown type hint", async () => {
    const fd = new FormData();
    fd.append("files", pdf("a.pdf", "%PDF-1.7"));
    fd.append("document_type", "passport");
    expect(await uploadDocumentsAction(undefined, fd)).toMatchObject({ ok: false, field: "document_type" });
  });

  it("processDocumentAction triggers the extractor for the uploaded id", async () => {
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, { document_type: "other", confidence: "low" });
    const res = await processDocumentAction(doc.id);
    expect(res).toMatchObject({ ok: true, state: "needs_review" });
    expect(st.extractorCalls.map((c) => c.id)).toEqual([doc.id]);
    expect(await processDocumentAction("not-a-uuid")).toEqual({ ok: false, error: "Invalid document id." });
  });
});

describe("explicit Create Load (human only)", () => {
  async function unmatchedRateCon() {
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RATE_CON());
    await processDocumentAction(doc.id);
    expect(st.docs.get(doc.id)!.review_status).toBe("needs_review");
    return doc.id;
  }

  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    const v = { load_number: "RC-1001", broker_name: "TQL", origin: "Dallas, TX", destination: "Atlanta, GA", pickup_date: "2026-09-28", delivery_date: "2026-09-30", total_revenue: "2400", ...over };
    for (const [k, x] of Object.entries(v)) fd.append(k, x);
    return fd;
  };

  it("creates exactly one load from the confirmed form, links the document, records the human action", async () => {
    const id = await unmatchedRateCon();
    await expect(createLoadFromDocumentAction(id, undefined, form())).rejects.toThrow(/redirect:\/loads\/loads-new-1/);
    expect(inserted.loads).toHaveLength(1);
    expect(inserted.loads![0]).toMatchObject({ load_number: "RC-1001", profile_id: OWNER, driver_id: null });
    const d = st.docs.get(id)!;
    expect(d.review_status).toBe("approved");
    expect(d.load_id).toBe("loads-new-1");
    expect(d.routing!.applied.map((a) => [a.kind, a.mode])).toEqual([["create_load", "human_approved"], ["attach_load", "human_approved"]]);
  });

  it("refuses to create a duplicate load (same normalised load number)", async () => {
    const id = await unmatchedRateCon();
    addLoad(st, { load_number: "rc 1001" }); // appeared after the decision
    const res = await createLoadFromDocumentAction(id, undefined, form());
    expect(res).toMatchObject({ ok: false });
    expect(res?.message).toMatch(/already exists/);
    expect(inserted.loads).toBeUndefined();
  });

  it("is refused for anything that is not an unmatched rate con in review", async () => {
    const doc = addDoc(st);
    storeExtraction(st, doc.id, { document_type: "fuel_receipt", confidence: "high" });
    st.docs.set(doc.id, { ...st.docs.get(doc.id)!, review_status: "needs_review" });
    expect(await createLoadFromDocumentAction(doc.id, undefined, form())).toMatchObject({ ok: false });
    expect(inserted.loads).toBeUndefined();
  });
});

describe("delete guard", () => {
  it("refuses to delete a document whose filed action is still live", async () => {
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, { document_type: "fuel_receipt", confidence: "high", vendor_name: "Pilot", expense_amount: 50, receipt_date: "2026-09-29" });
    await processDocumentAction(doc.id);
    expect(st.docs.get(doc.id)!.review_status).toBe("auto_routed");
    await expect(deleteDocumentAction(doc.id)).rejects.toThrow(/Undo/);
  });
});
