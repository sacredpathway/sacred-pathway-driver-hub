// =============================================================================
//  TEST ONLY — a supabase-js look-alike backed by a REAL local Postgres
//  (throwaway cluster), for the end-to-end Smart Payroll Upload workflow test.
//  Each call runs in its own transaction as role `authenticated` with
//  request.jwt.claim.sub = the signed-in user, exactly like PostgREST, so RLS,
//  triggers and the real database functions decide everything.
//  Supports only the query-builder subset the code under test uses; anything
//  else throws so a gap can't pass silently.
// =============================================================================

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] } | { rows: Record<string, unknown>[] }[]>;
  release(): void;
}
export interface PgPoolLike { connect(): Promise<PgClientLike> }

type PgErr = { message: string; code?: string; detail?: string; hint?: string };
type Result = { data: unknown; error: { message: string; code: string | null; details: string | null; hint: string | null } | null };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`pgSupabase: unsupported identifier ${JSON.stringify(id)}`);
  return `"${id}"`;
};

export async function runAs(pool: PgPoolLike, uid: string | null, sql: string, params: unknown[]): Promise<Result> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local timezone = 'UTC'");
    if (uid) {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
        [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    }
    const res = await c.query(sql, params);
    const r = Array.isArray(res) ? res[res.length - 1] : res; // multi-statement (test setup only)
    await c.query("commit");
    return { data: r?.rows?.[0]?.j ?? null, error: null };
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    const pe = e as PgErr;
    return { data: null, error: { message: pe.message, code: pe.code ?? null, details: pe.detail ?? null, hint: pe.hint ?? null } };
  } finally {
    c.release();
  }
}

/** Many-to-one embed resolved like PostgREST: from the REAL foreign keys of
 *  `table` -> `rel`. Unqualified + more than one FK -> PGRST201 (ambiguous);
 *  `rel!fk_name!inner(...)` picks that FK; unknown FK -> PGRST200. */
async function resolveEmbed(pool: PgPoolLike, table: string, rel: string, hint: string | null): Promise<string> {
  const r = await runAs(pool, null,
    `select coalesce(json_agg(json_build_object('name', c.conname::text, 'col', a.attname::text) order by c.conname), '[]'::json) as j
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.conrelid = to_regclass('public.' || $1) and c.confrelid = to_regclass('public.' || $2)
        and array_length(c.conkey, 1) = 1`, [table, rel]);
  if (r.error) throw new EmbedError(r.error.message, "PGRST200");
  const fks = (r.data ?? []) as { name: string; col: string }[];
  if (hint) {
    const hit = fks.find((f) => f.name === hint);
    if (!hit) throw new EmbedError(`Could not find a relationship between '${table}' and '${rel}' in the schema cache`, "PGRST200");
    return hit.col;
  }
  if (fks.length === 0) throw new EmbedError(`Could not find a relationship between '${table}' and '${rel}' in the schema cache`, "PGRST200");
  if (fks.length > 1) throw new EmbedError(`Could not embed because more than one relationship was found for '${table}' and '${rel}'`, "PGRST201");
  return fks[0].col;
}
class EmbedError extends Error { constructor(message: string, public code: string) { super(message); } }

/** "a, b, rel!inner(x, y)" or "rel!fk_name!inner(x, y)" -> select list over alias t (one embedded level). */
async function selectList(pool: PgPoolLike, table: string, cols: string): Promise<{ list: string; joins: string }> {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of cols) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const list: string[] = [];
  const joins: string[] = [];
  for (const p of parts) {
    if (p === "*") { list.push("t.*"); continue; }
    const m = /^([a-z_]+)(?:!([a-z_][a-z0-9_]*))?!inner\(([^)]*)\)$/.exec(p);
    if (m) {
      const rel = m[1];
      const fk = await resolveEmbed(pool, table, rel, m[2] ?? null);
      joins.push(`join public.${q(rel)} ${q(rel)} on ${q(rel)}.id = t.${q(fk)}`);
      const inner = m[3].split(",").map((s) => s.trim()).filter(Boolean);
      list.push(`json_build_object(${inner.map((c) => `'${c}', ${q(rel)}.${q(c)}`).join(", ")}) as ${q(rel)}`);
      continue;
    }
    if (p.includes("!") || p.includes("(")) throw new Error(`pgSupabase: unsupported select item ${JSON.stringify(p)}`);
    list.push(`t.${q(p)}`);
  }
  return { list: list.join(", "), joins: joins.join(" ") };
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "update" | "insert" | "delete" = "select";
  private cols = "*";
  private returning: string | null = null;
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private lim: number | null = null;
  private patch: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private mode: "many" | "maybe" | "single" = "many";

  constructor(private pool: PgPoolLike, private uid: string | null, private table: string) { q(table); }

  private p(v: unknown) {
    this.params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
    return `$${this.params.length}`;
  }
  private f(sql: string) { this.where.push(sql); return this; }

  select(cols = "*") { if (this.op === "select") this.cols = cols; else this.returning = cols; return this; }
  update(patch: Record<string, unknown>) { this.op = "update"; this.patch = patch; return this; }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]) { this.op = "insert"; this.patch = rows; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { return this.f(`t.${q(c)} = ${this.p(v)}`); }
  neq(c: string, v: unknown) { return this.f(`t.${q(c)} is distinct from ${this.p(v)}`); }
  gt(c: string, v: unknown) { return this.f(`t.${q(c)} > ${this.p(v)}`); }
  gte(c: string, v: unknown) { return this.f(`t.${q(c)} >= ${this.p(v)}`); }
  lt(c: string, v: unknown) { return this.f(`t.${q(c)} < ${this.p(v)}`); }
  lte(c: string, v: unknown) { return this.f(`t.${q(c)} <= ${this.p(v)}`); }
  ilike(c: string, v: string) { return this.f(`t.${q(c)} ilike ${this.p(v)}`); }
  in(c: string, v: unknown[]) { return this.f(`t.${q(c)}::text = any(${this.p(v.map(String))}::text[])`); }
  is(c: string, v: null | boolean) {
    if (v === null) return this.f(`t.${q(c)} is null`);
    return this.f(`t.${q(c)} is ${v ? "true" : "false"}`);
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) return this.f(`t.${q(c)} is not null`);
    throw new Error(`pgSupabase: unsupported not(${op})`);
  }
  /** PostgREST logic tree: "a.eq.1,and(b.lt.2,c.is.null)" (eq / neq / lt / gt / in / is). */
  or(expr: string) { return this.f(`(${this.logic(expr, "or")})`); }
  private logic(expr: string, join: "or" | "and"): string {
    const parts: string[] = [];
    let depth = 0, cur = "";
    for (const ch of expr) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) parts.push(cur);
    const sql = parts.map((p) => {
      const m = /^(and|or)\((.*)\)$/.exec(p.trim());
      if (m) return `(${this.logic(m[2], m[1] as "or" | "and")})`;
      const c = /^([a-z_]+)\.(eq|neq|lt|gt|lte|gte|in|is)\.(.*)$/.exec(p.trim());
      if (!c) throw new Error(`pgSupabase: unsupported or() item ${JSON.stringify(p)}`);
      const [, col, op, val] = c;
      if (op === "is") return val === "null" ? `t.${q(col)} is null` : `t.${q(col)} is ${val === "true" ? "true" : "false"}`;
      if (op === "in") return `t.${q(col)}::text = any(${this.p(val.replace(/^\(|\)$/g, "").split(","))}::text[])`;
      const sym = { eq: "=", neq: "<>", lt: "<", gt: ">", lte: "<=", gte: ">=" }[op as "eq"];
      return `t.${q(col)} ${sym} ${this.p(val)}`;
    });
    return sql.join(` ${join} `);
  }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy.push(`t.${q(c)} ${o?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }

  private async sql(): Promise<string> {
    const where = this.where.length ? `where ${this.where.join(" and ")}` : "";
    const tail = `${this.orderBy.length ? `order by ${this.orderBy.join(", ")}` : ""} ${this.lim !== null ? `limit ${Number(this.lim)}` : ""}`;
    if (this.op === "select") {
      const { list, joins } = await selectList(this.pool, this.table, this.cols);
      return `select coalesce(json_agg(x), '[]'::json) as j from (select ${list} from public.${q(this.table)} t ${joins} ${where} ${tail}) x`;
    }
    if (this.op === "delete") {
      const ret = this.returning ? (await selectList(this.pool, this.table, this.returning)).list : "t.id";
      return `with t as (delete from public.${q(this.table)} t ${where} returning t.*) select coalesce(json_agg(x), '[]'::json) as j from (select ${ret} from t) x`;
    }
    if (this.op === "update") {
      const sets = Object.entries(this.patch as Record<string, unknown>).map(([k, v]) => `${q(k)} = ${this.p(v)}`);
      const ret = this.returning ? (await selectList(this.pool, this.table, this.returning)).list : "t.id";
      return `with t as (update public.${q(this.table)} t set ${sets.join(", ")} ${where} returning t.*) select coalesce(json_agg(x), '[]'::json) as j from (select ${ret} from t) x`;
    }
    const rows = Array.isArray(this.patch) ? this.patch : [this.patch as Record<string, unknown>];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const ret = this.returning ? (await selectList(this.pool, this.table, this.returning)).list : "t.id";
    const json = this.p(JSON.stringify(rows));
    return `with t as (insert into public.${q(this.table)} (${keys.map(q).join(", ")})
              select ${keys.map(q).join(", ")} from json_populate_recordset(null::public.${q(this.table)}, ${json}::json) returning *)
            select coalesce(json_agg(x), '[]'::json) as j from (select ${ret} from t) x`;
  }

  async run(): Promise<Result> {
    let text: string;
    try { text = await this.sql(); } catch (e) {
      if (e instanceof EmbedError) return { data: null, error: { message: e.message, code: e.code, details: null, hint: null } };
      throw e;
    }
    const r = await runAs(this.pool, this.uid, text, this.params);
    if (r.error) return r;
    const rows = (r.data ?? []) as unknown[];
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116", details: null, hint: null } };
      return { data: rows[0] ?? null, error: null };
    }
    if (this.mode === "single") {
      if (rows.length !== 1) return { data: null, error: { message: "expected one row", code: "PGRST116", details: null, hint: null } };
      return { data: rows[0], error: null };
    }
    return { data: this.op === "select" || this.returning ? rows : null, error: null };
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad);
  }
}

/** RPC through the real function: named arguments, set-returning aware. */
async function rpc(pool: PgPoolLike, uid: string | null, name: string, args: Record<string, unknown> = {}): Promise<Result> {
  q(name);
  const meta = await runAs(pool, null, `select json_build_object('setof', p.proretset) as j from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [name]);
  if (!meta.data) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache`, code: "PGRST202", details: null, hint: null } };
  const params: unknown[] = [];
  const named = Object.entries(args).map(([k, v]) => {
    params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
    return `${q(k)} => $${params.length}`;
  });
  const call = `public.${q(name)}(${named.join(", ")})`;
  const sql = (meta.data as { setof: boolean }).setof
    ? `select coalesce(json_agg(x), '[]'::json) as j from ${call} x`
    : `select to_json(${call}) as j`;
  return runAs(pool, uid, sql, params);
}

export interface FakeStorage { objects: Map<string, { size: number; type: string; text?: string }> }
export type FakeFunctions = (name: string, body: Record<string, unknown>, uid: string | null) => Promise<{ data: unknown; error: unknown }>;

export function pgSupabase(pool: PgPoolLike, user: { id: string; email: string } | null, storage: FakeStorage = { objects: new Map() }, functions?: FakeFunctions) {
  const uid = user?.id ?? null;
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => new Builder(pool, uid, table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc(pool, uid, name, args),
    functions: {
      invoke: async (name: string, o?: { body?: Record<string, unknown> }) => {
        if (!functions) return { data: null, error: { message: "functions not configured" } };
        return functions(name, o?.body ?? {}, uid);
      },
    },
    storage: {
      from: (bucket?: string) => ({
        bucket: bucket ?? "documents",
        upload: async (path: string, file: Blob, o?: { contentType?: string }) => {
          if (storage.objects.has(path)) return { error: { message: "The resource already exists" } };
          storage.objects.set(path, { size: file.size, type: o?.contentType ?? file.type, text: await file.text().catch(() => "") });
          return { error: null };
        },
        remove: async (paths: string[]) => { paths.forEach((p) => storage.objects.delete(p)); return { error: null }; },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `local-test://${path}` }, error: null }),
      }),
    },
  };
}
