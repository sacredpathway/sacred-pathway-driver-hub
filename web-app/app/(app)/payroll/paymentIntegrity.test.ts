// Source-level guarantees for the payroll server actions + the migration they
// depend on. Behaviour of the SQL itself is proven by the database suite in
// supabase/tests/paystub_payment_integrity (run.sh).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const migration = readFileSync(
  join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "20261001120000_paystub_payment_integrity.sql"),
  "utf8",
);

function fnBody(name: string): string {
  const start = actions.indexOf(`export async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = actions.indexOf("\nexport async function ", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
}

describe("issuePaystubAction", () => {
  const body = fnBody("issuePaystubAction");
  it("issues through the atomic database RPC", () => {
    expect(body).toContain("supabase.rpc(ISSUE_PAYSTUB_RPC, { p_paystub_id: paystubId })");
  });
  it("keeps the JS pay engine as the only totals calculator", () => {
    expect(body).toContain("recomputeAndPersistTotals(supabase, paystubId)");
    expect(body.indexOf("recomputeAndPersistTotals")).toBeLessThan(body.indexOf("ISSUE_PAYSTUB_RPC"));
  });
  it("has no second issuance implementation (numbering / YTD / status write)", () => {
    expect(body).not.toMatch(/PS-\$\{/);
    expect(body).not.toMatch(/ytd_/);
    expect(body).not.toMatch(/status:\s*"issued"/);
    expect(body).not.toMatch(/\.from\("loads"\)\s*\.update/);
    expect(actions).not.toMatch(/status:\s*"issued"/);
    expect(actions).not.toMatch(/status:\s*"settled"/);
  });
});

describe("voidPaystubAction", () => {
  const body = fnBody("voidPaystubAction");
  it("voids through the atomic database RPC and never writes status directly", () => {
    expect(body).toContain("supabase.rpc(VOID_PAYSTUB_RPC, { p_paystub_id: paystubId })");
    expect(body).not.toMatch(/status:\s*"voided"/);
    expect(actions).not.toMatch(/status:\s*"voided"/);
  });
});

describe("markPaidAction", () => {
  const body = fnBody("markPaidAction");
  it("only moves issued → paid (conditional update, zero rows is an error)", () => {
    expect(body).toMatch(/update\(\{ status: "paid" \}\)[\s\S]*\.eq\("status", "issued"\)[\s\S]*\.select\("id"\)/);
    expect(body).toContain("Only issued paystubs can be marked paid.");
  });
  it("is not a settle event", () => {
    expect(body).not.toMatch(/loads/);
    expect(body).not.toMatch(/settled/);
  });
});

describe("drafts never settle loads", () => {
  it("createPaystubAction pre-checks load conflicts and inserts a draft only", () => {
    const body = fnBody("createPaystubAction");
    expect(body).toContain("supabase.rpc(LOAD_CONFLICTS_RPC");
    expect(body.indexOf("LOAD_CONFLICTS_RPC")).toBeLessThan(body.indexOf('.from("paystubs")'));
    expect(body).toContain('status: "draft"');
    expect(body).not.toMatch(/\.from\("loads"\)\s*\.update/);
  });
  it("addLoadToDraftAction maps database conflicts and never updates the load", () => {
    const body = fnBody("addLoadToDraftAction");
    expect(body).toContain("integrityMessage(error, tag)");
    expect(body).not.toMatch(/\.from\("loads"\)\s*\.update/);
  });
});

describe("migration shape", () => {
  it("defines the approved functions and triggers", () => {
    for (const f of [
      "public.sph_load_paid_elsewhere(",
      "public.sph_load_payment_conflict(",
      "public.sph_loads_payment_conflicts(",
      "public.sph_paystub_earnings_guard()",
      "public.sph_paystubs_guard_status()",
      "public.issue_paystub(p_paystub_id uuid)",
      "public.void_paystub(p_paystub_id uuid)",
    ]) expect(migration).toContain(`create or replace function ${f}`);
    expect(migration).toContain("create trigger sph_paystub_earnings_guard");
    expect(migration).toContain("create trigger sph_paystubs_guard_status");
  });
  it("adds no SECURITY DEFINER code and pins search_path everywhere", () => {
    const code = migration.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/security\s+definer/i);
    expect((code.match(/security invoker/g) ?? []).length).toBe((code.match(/create or replace function/g) ?? []).length);
    const fns = migration.match(/create or replace function/g) ?? [];
    const paths = migration.match(/set search_path = public, pg_temp/g) ?? [];
    expect(paths.length).toBe(fns.length);
  });
  it("revokes anon/PUBLIC execute on every function", () => {
    for (const f of ["issue_paystub(uuid)", "void_paystub(uuid)", "sph_load_payment_conflict(uuid, uuid)",
                     "sph_load_paid_elsewhere(uuid, uuid)", "sph_loads_payment_conflicts(uuid[], uuid)"]) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${f.replace(/[()[\]]/g, "\\$&")}\\s+from public, anon;`));
    }
  });
  it("is additive: no DDL on existing tables/columns, no RLS changes, no bulk data rewrites", () => {
    const code = migration.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bdrop\s+(table|column|policy|function)\b/i);
    expect(code).not.toMatch(/\bcreate\s+policy\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    // Every UPDATE is scoped to specific rows inside a function body.
    const updates = code.match(/update public\.\w+[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toMatch(/\bwhere\b/);
  });
});

describe("cross-platform migration (20261001120100)", () => {
  const m2 = readFileSync(
    join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "20261001120100_cross_platform_payment_integrity.sql"),
    "utf8",
  );
  const code = m2.replace(/--.*$/gm, "");

  it("guards iPhone approval, late line attach, still-paid release and non-draft delete", () => {
    for (const t of [
      "create trigger sph_settlements_guard_approval",
      "create trigger sph_settlement_loads_guard",
      "create trigger sph_loads_keep_paid_settled",
      "create trigger sph_paystubs_guard_delete",
    ]) expect(code).toContain(t);
  });
  it("sorts after the first integrity migration", () => {
    expect("20261001120100" > "20261001120000").toBe(true);
  });
  it("is SECURITY INVOKER with pinned search_path, and additive", () => {
    expect(code).not.toMatch(/security\s+definer/i);
    const fns = (code.match(/create or replace function/g) ?? []).length;
    expect((code.match(/security invoker/g) ?? []).length).toBe(fns);
    expect((code.match(/set search_path = public, pg_temp/g) ?? []).length).toBe(fns);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bdrop\s+(table|column|policy|function)\b/i);
    expect(code).not.toMatch(/\bcreate\s+policy\b/i);
    expect(code).not.toMatch(/\b(update|delete\s+from|insert\s+into)\s+public\./i);
  });
  it("never uses phrases the iPhone app reads as 'database update missing'", () => {
    const msgs = code.match(/v_msg := [^;]+;/g) ?? [];
    expect(msgs.length).toBeGreaterThan(0);
    for (const msg of msgs) expect(msg).not.toMatch(/does not exist|schema cache/i);
  });
});

describe("deleteDraftAction", () => {
  it("only deletes drafts and maps the database guard", () => {
    const body = fnBody("deleteDraftAction");
    expect(body).toMatch(/\.delete\(\)[\s\S]*\.eq\("status", "draft"\)/);
    expect(body).toContain("integrityMessage(error)");
  });
});
