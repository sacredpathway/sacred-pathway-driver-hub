import { describe, expect, it } from "vitest";
import { registerUpload, sha256Hex, type UploadDeps } from "./upload";

const OWNER = "AAAAAAAA-0000-4000-8000-000000000001";

function deps(over: Partial<UploadDeps> = {}) {
  const rows: Record<string, unknown>[] = [];
  const stored: string[] = [];
  const removed: string[] = [];
  const byHash = new Map<string, string>();
  let n = 0;
  const d: UploadDeps = {
    ownerId: OWNER,
    now: () => new Date("2026-10-01T12:00:00Z"),
    newId: () => `DDDDDDDD-0000-4000-8000-00000000000${++n}`,
    async storeObject(path) {
      stored.push(path);
      return { error: null };
    },
    async removeObject(path) {
      removed.push(path);
    },
    async findByHash(h) {
      const id = byHash.get(h);
      return id ? { id } : null;
    },
    async insertDocument(row) {
      rows.push(row);
      byHash.set(row.content_sha256 as string, row.id as string);
      return { error: null };
    },
    ...over,
  };
  return { d, rows, stored, removed };
}

const file = (text: string, type = "application/pdf") => {
  const bytes = new TextEncoder().encode(text);
  return { name: "rc.pdf", type, size: bytes.length, blob: new Blob([bytes]), bytes: bytes.buffer as ArrayBuffer };
};

describe("sha256", () => {
  it("matches the known vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("registerUpload", () => {
  it("stores under <owner>/<id>.<ext> (lowercase) and inserts a pending web row with hash", async () => {
    const { d, rows, stored } = deps();
    const res = await registerUpload(d, file("%PDF-1.7 one"), "pdf", { typeHint: "rate_confirmation", loadId: null });
    expect(res.ok).toBe(true);
    expect(stored[0]).toMatch(/^aaaaaaaa-0000-4000-8000-000000000001\/dddddddd-0000-4000-8000-000000000001\.pdf$/);
    expect(rows[0]).toMatchObject({
      status: "pending",
      source: "web",
      document_type: "rate_confirmation",
      processed: false,
      file_mime_type: "application/pdf",
    });
    expect(rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].duplicate_of).toBeUndefined();
  });

  it("same bytes again: still uploaded (never refused/deleted) but marked duplicate + needs_review", async () => {
    const { d, rows } = deps();
    const a = await registerUpload(d, file("%PDF-1.7 same"), "pdf", { typeHint: null, loadId: null });
    const b = await registerUpload(d, file("%PDF-1.7 same"), "pdf", { typeHint: null, loadId: null });
    expect(a.ok && b.ok).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ duplicate_of: rows[0].id, review_status: "needs_review" });
    expect((rows[1].routing as { reasons: string[] }).reasons).toEqual(["duplicate_file"]);
    if (b.ok) expect(b.doc.duplicateOf).toBe(rows[0].id);
  });

  it("an unknown/legacy type hint is not stored as a routable type", async () => {
    const { d, rows } = deps();
    await registerUpload(d, file("%PDF x"), "pdf", { typeHint: "passport", loadId: null });
    expect(rows[0].document_type).toBeNull();
  });

  it("storage failure inserts nothing; insert failure removes the stored object", async () => {
    const s1 = deps({ storeObject: async () => ({ error: "quota" }) });
    expect(await registerUpload(s1.d, file("x".repeat(10)), "pdf", { typeHint: null, loadId: null })).toMatchObject({ ok: false });
    expect(s1.rows).toHaveLength(0);
    const s2 = deps({ insertDocument: async () => ({ error: "rls" }) });
    expect(await registerUpload(s2.d, file("y".repeat(10)), "pdf", { typeHint: null, loadId: null })).toMatchObject({ ok: false });
    expect(s2.removed).toHaveLength(1);
  });
});
