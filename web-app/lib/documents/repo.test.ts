// =============================================================================
//  createDocumentRepo().documentInFinalizedSettlement — the query that guards
//  undo attach-load (Step 5). The fake applies the same inner-join + status
//  filter PostgREST would, so approved/paid lines match and others don't.
// =============================================================================
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDocumentRepo, FINALIZED_SETTLEMENT_LINES_SELECT, SettlementCheckError } from "./repo";

const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC = "dddddddd-0000-4000-8000-000000000001";

type Line = { id: string; profile_id: string; rate_confirmation_document_id: string | null; proof_of_delivery_document_id: string | null; settlements: { status: string } };
interface Call { table: string; select?: string; or?: string; eq: [string, unknown][]; in: [string, unknown[]][] }

function fakeSupabase(result: { lines?: Line[]; error?: string; nullData?: boolean }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, eq: [], in: [] };
    calls.push(c);
    const b = {
      select: (s: string) => { c.select = s; return b; },
      or: (s: string) => { c.or = s; return b; },
      eq: (k: string, v: unknown) => { c.eq.push([k, v]); return b; },
      in: (k: string, v: unknown[]) => { c.in.push([k, v]); return b; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        if (result.error) return Promise.resolve({ data: null, error: { message: result.error, code: "PGRST201" } }).then(ok, bad);
        if (result.nullData) return Promise.resolve({ data: null, error: null }).then(ok, bad);
        const docIds = [...(c.or ?? "").matchAll(/\.eq\.([0-9a-f-]{36})/g)].map((m) => m[1]);
        const statuses = (c.in.find(([k]) => k === "settlements.status")?.[1] ?? []) as string[];
        const owner = c.eq.find(([k]) => k === "profile_id")?.[1];
        const rows = (result.lines ?? []).filter((l) =>
          l.profile_id === owner && statuses.includes(l.settlements.status) &&
          (docIds.includes(l.rate_confirmation_document_id ?? "") || docIds.includes(l.proof_of_delivery_document_id ?? "")));
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id, settlements: r.settlements })), error: null }).then(ok, bad);
      },
    };
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const line = (status: string, over: Partial<Line> = {}): Line => ({
  id: "11111111-0000-4000-8000-000000000001", profile_id: OWNER, rate_confirmation_document_id: DOC, proof_of_delivery_document_id: null,
  settlements: { status }, ...over,
});

describe("documentInFinalizedSettlement", () => {
  it("names the settlement_id foreign key explicitly and keeps the approved/paid rule", async () => {
    const { client, calls } = fakeSupabase({ lines: [] });
    await createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.table).toBe("settlement_loads");
    expect(c.select).toBe(FINALIZED_SETTLEMENT_LINES_SELECT);
    expect(c.select).toBe("id, settlements!settlement_loads_settlement_id_fkey!inner(status)");
    expect(c.select).not.toMatch(/(^|[\s,])settlements!inner\(/);
    expect(c.or).toBe(`rate_confirmation_document_id.eq.${DOC},proof_of_delivery_document_id.eq.${DOC}`);
    expect(c.eq).toContainEqual(["profile_id", OWNER]);
    expect(c.in).toEqual([["settlements.status", ["approved", "paid"]]]);
  });

  it("approved settlement -> protected", async () => {
    const { client } = fakeSupabase({ lines: [line("approved")] });
    expect(await createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).toBe(true);
  });

  it("paid settlement (via proof of delivery) -> protected", async () => {
    const { client } = fakeSupabase({ lines: [line("paid", { rate_confirmation_document_id: null, proof_of_delivery_document_id: DOC })] });
    expect(await createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).toBe(true);
  });

  it("draft / ready_for_review / voided settlements and other accounts -> not protected", async () => {
    const { client } = fakeSupabase({ lines: [line("draft"), line("ready_for_review"), line("voided"), line("approved", { profile_id: "bbbbbbbb-0000-4000-8000-000000000001" })] });
    expect(await createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).toBe(false);
  });

  it("no settlement line -> not protected", async () => {
    const { client } = fakeSupabase({ lines: [] });
    expect(await createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).toBe(false);
  });

  it("a query error FAILS CLOSED (throws, never returns false)", async () => {
    const { client } = fakeSupabase({ error: "Could not embed because more than one relationship was found for 'settlement_loads' and 'settlements'" });
    await expect(createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).rejects.toBeInstanceOf(SettlementCheckError);
  });

  it("a missing result without an error also FAILS CLOSED", async () => {
    const { client } = fakeSupabase({ nullData: true });
    await expect(createDocumentRepo(client, OWNER).documentInFinalizedSettlement(DOC)).rejects.toBeInstanceOf(SettlementCheckError);
  });
});
