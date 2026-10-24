// Migration #3 (20261023140000_settlement_lock_order.sql) must be the
// production functions from #2 (20261023130000, sha 3a5b3456…) plus ONLY the
// two documented lock blocks. Any other drift — a changed check, message,
// payload key or column — fails here before it can reach the database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");
const M2 = readFileSync(join(DIR, "20261023130000_web_settlement_atomic_writes.sql"), "utf8");
const M3 = readFileSync(join(DIR, "20261023140000_settlement_lock_order.sql"), "utf8");

function fn(src: string, name: string): string {
  const start = src.indexOf(`create or replace function public.${name}(p jsonb)`);
  if (start < 0) throw new Error(`no ${name}`);
  return src.slice(start, src.indexOf("$$;\n", start) + 4);
}
// The added blocks start with a "-- 20261023140000:" comment and end at the
// blank line before the next original statement.
function withoutLockBlocks(body: string): { body: string; blocks: string[] } {
  const blocks: string[] = [];
  const out = body.replace(/  -- 20261023140000:[\s\S]*?\n\n/g, (b) => {
    blocks.push(b);
    return "";
  });
  return { body: out, blocks };
}

describe("migration #3 lock order", () => {
  it("leaves production migration #2 byte-identical", () => {
    expect(createHash("sha256").update(M2).digest("hex")).toBe(
      "3a5b3456be195491ed7a1f6a8ea078730447b56b3d25d52c02a55e8b8fe18ada",
    );
  });

  for (const name of ["sph_web_save_settlement", "sph_web_transition_settlement"]) {
    it(`${name} = #2 plus exactly one lock block`, () => {
      const { body, blocks } = withoutLockBlocks(fn(M3, name));
      expect(blocks).toHaveLength(1);
      expect(body).toBe(fn(M2, name));
    });
  }

  it("save locks loads and advances in id order with KEY SHARE before writing lines", () => {
    const [block] = withoutLockBlocks(fn(M3, "sph_web_save_settlement")).blocks;
    expect(block).toMatch(/from public\.loads l[\s\S]*order by l\.id\s+for key share;/);
    expect(block).toMatch(/from public\.driver_advances a[\s\S]*order by a\.id\s+for key share;/);
    const save = fn(M3, "sph_web_save_settlement");
    expect(save.indexOf("for key share")).toBeLessThan(save.indexOf("insert into public.settlement_loads"));
  });

  it("transition locks the settlement's loads in id order before the status update", () => {
    const tr = fn(M3, "sph_web_transition_settlement");
    const [block] = withoutLockBlocks(tr).blocks;
    expect(block).toMatch(/order by l\.id\s+for update;/);
    expect(tr.indexOf(block)).toBeLessThan(tr.indexOf("update public.settlements s set"));
    expect(tr.indexOf(block)).toBeGreaterThan(tr.indexOf("for update;\n  if not found"));
  });

  it("keeps the comments and grants of #2", () => {
    for (const line of [
      "comment on function public.sph_web_save_settlement(jsonb) is",
      "comment on function public.sph_web_transition_settlement(jsonb) is",
      "revoke all on function public.sph_web_save_settlement(jsonb) from public, anon;",
      "revoke all on function public.sph_web_transition_settlement(jsonb) from public, anon;",
      "grant execute on function public.sph_web_save_settlement(jsonb) to authenticated;",
      "grant execute on function public.sph_web_transition_settlement(jsonb) to authenticated;",
    ]) {
      expect(M3).toContain(line);
      expect(M2).toContain(line);
    }
  });
});
