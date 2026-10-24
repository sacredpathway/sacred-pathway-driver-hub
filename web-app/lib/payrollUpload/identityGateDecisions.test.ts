import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carrierIdentityFromProfile, dotKey, isCarrierOwnerAccount } from "./carrierIdentity";
import { payrollConfirmGate } from "./featureFlag";
import { sanitizeDecisions } from "./decisions";

const P = { id: "aaaaaaaa-0000-4000-8000-000000000001", company_name: "Synthetic Haul LLC", mc_number: "MC# 900001", dot_number: "USDOT 7000001", account_type: null, account_role: null };

describe("carrier identity comes only from the profile", () => {
  it("normalises name / MC / DOT and is verified", () => {
    expect(carrierIdentityFromProfile(P)).toMatchObject({ verified: true, names: ["Synthetic Haul LLC"], mcNumbers: ["900001"], dotNumbers: ["7000001"], reasons: [] });
  });
  it("no identifiers -> unverified; MC alone is enough", () => {
    expect(carrierIdentityFromProfile({ ...P, company_name: null, mc_number: null, dot_number: null })).toMatchObject({ verified: false, reasons: expect.arrayContaining(["no_identifiers"]) });
    expect(carrierIdentityFromProfile({ ...P, company_name: null })).toMatchObject({ verified: true, names: [] });
  });
  it("driver accounts are never a verified carrier", () => {
    expect(carrierIdentityFromProfile({ ...P, account_type: "driver" })?.verified).toBe(false);
  });
  it("garbage MC is reported, not used", () => {
    expect(carrierIdentityFromProfile({ ...P, mc_number: "n/a" })).toMatchObject({ mcNumbers: [], reasons: expect.arrayContaining(["mc_number_unreadable"]) });
    expect(dotKey("DOT 12")).toBeNull();
  });
  it("owner gate: null / carrier role only", () => {
    expect(isCarrierOwnerAccount(P)).toBe(true);
    expect(isCarrierOwnerAccount({ account_type: null, account_role: "carrier" })).toBe(true);
    for (const r of ["dispatcher", "driver", "owner_operator"]) expect(isCarrierOwnerAccount({ account_type: null, account_role: r })).toBe(false);
    expect(isCarrierOwnerAccount({ account_type: "driver", account_role: null })).toBe(false);
    expect(isCarrierOwnerAccount(null)).toBe(false);
  });
});

describe("no company identifier is hard-coded", () => {
  // Real identifiers of the owner's companies must never appear in source.
  // Checked by pattern (any 6-7 digit MC/DOT-looking literal next to MC/DOT,
  // or a company-name literal) across the Smart Payroll Upload sources.
  const roots = [join(__dirname), join(__dirname, "..", "..", "app", "(app)", "documents", "[id]", "payroll")];
  const files = roots.flatMap((r) => readdirSync(r).map((f) => join(r, f))).filter((f) => statSync(f).isFile() && /\.(ts|tsx)$/.test(f) && !/(test|fixtures|test-helpers)\./.test(f));
  it("scans the non-test sources", () => expect(files.length).toBeGreaterThanOrEqual(10));
  it.each(files)("%s has no MC/DOT number or company-name literal", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/\b(MC|DOT|USDOT)[#\s:]*\d{5,8}\b/i);
    expect(src).not.toMatch(/(Sacred Pathway|Hinton Eagle)/i);
    expect(src).not.toMatch(/\b(1647441|4250348)\b/);
  });
});

describe("confirmation gate", () => {
  it.each([
    [{}, false, "flag_off"],
    [{ SMART_PAYROLL_CONFIRM: "1" }, false, "flag_off"],
    [{ SMART_PAYROLL_CONFIRM: "local-only" }, false, "missing_database_url"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }, false, "not_local_database"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1.evil.example" }, false, "not_local_database"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "not a url" }, false, "missing_database_url"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }, true, "enabled_staging_only"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co/" }, true, "enabled_staging_only"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://rmzqxsfhjqrshhdjzhze.supabase.co" }, false, "production_database"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "https://rmzqxsfhjqrshhdjzhze.supabase.co" }, false, "production_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://rmzqxsfhjqrshhdjzhze.aatkirzwuuegurdlmcpl.supabase.co" }, false, "production_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "http://aatkirzwuuegurdlmcpl.supabase.co" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co.evil.example" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co:8443" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://user:pw@aatkirzwuuegurdlmcpl.supabase.co" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://other-project.supabase.co" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, false, "not_staging_database"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }, false, "not_local_database"],
    [{ SMART_PAYROLL_CONFIRM: "STAGING-ONLY", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }, false, "flag_off"],
    [{ SMART_PAYROLL_CONFIRM: "true", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }, false, "flag_off"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, true, "enabled_local_only"],
    [{ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, true, "enabled_local_only"],
  ])("%j -> %s", (env, enabled, reason) => {
    expect(payrollConfirmGate(env as Record<string, string>)).toEqual({ enabled, reason });
  });
});

describe("browser decisions are sanitised", () => {
  it("keeps valid choices, drops everything else", () => {
    const d = sanitizeDecisions({
      loadId: "AAAAAAAA-0000-4000-8000-0000000A0045", evil: true,
      target: { kind: "new_draft", periodStart: "2026-10-12", periodEnd: "2026-13-40", applyRecurring: "yes" },
      corrections: { total_revenue: { value: "2450.00", note: "x".repeat(500) }, not_a_field: { value: 1 }, load_number: { value: { $ne: 1 } } },
      acknowledged: ["identity:unverified", 5, "x".repeat(200)],
    });
    expect(d).toEqual({
      loadId: "aaaaaaaa-0000-4000-8000-0000000a0045",
      target: { kind: "new_draft", periodStart: "2026-10-12", periodEnd: "", applyRecurring: false },
      corrections: { total_revenue: { value: "2450.00", note: "x".repeat(200) } },
      acknowledged: ["identity:unverified"],
    });
  });
  it("rejects malformed ids and non-objects", () => {
    expect(sanitizeDecisions({ loadId: "1; drop table", target: { kind: "existing_draft", settlementId: "x" } })).toEqual({});
    expect(sanitizeDecisions(null)).toEqual({});
    expect(sanitizeDecisions("x")).toEqual({});
  });
});
