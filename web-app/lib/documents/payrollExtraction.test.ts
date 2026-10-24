import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dateSpellings,
  moneySpellings,
  normalizePayrollType,
  PAYROLL_FIELDS_BY_TYPE,
  sanitizePayrollExtraction,
  storedDocumentType,
  SYSTEM_PROMPT_V3,
  toV2Compatible,
  valueAppearsIn,
} from "./payrollExtraction";
import { FIELDS_BY_TYPE, sanitizeExtraction, SYSTEM_PROMPT_V2 } from "./extraction";
import { CANONICAL_DOCUMENT_TYPES } from "./taxonomy";
import * as fx from "../payrollUpload/fixtures";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("one shared payroll profile (web copy === Edge Function canonical)", () => {
  it("payrollExtraction.ts matches the Edge Function copy except import specifiers", () => {
    const deno = read("../../../supabase/functions/_shared/payroll-extraction.ts")
      .replace('from "./document-extraction.ts";', 'from "./extraction";')
      .replace('from "./document-taxonomy.ts";', 'from "./taxonomy";');
    expect(read("./payrollExtraction.ts")).toBe(deno);
  });
});

describe("v1/v2 untouched", () => {
  it("v2 prompt and v2 field lists are unchanged by the v3 profile", () => {
    expect(SYSTEM_PROMPT_V2).not.toContain("settlement_statement");
    expect(FIELDS_BY_TYPE.rate_confirmation).not.toContain("driver_name");
    // v2 sanitiser still drops payroll-only fields
    const v2 = sanitizeExtraction({ document_type: "rate_confirmation", load_number: "A1234", driver_name: "John Doe" });
    expect(v2.fields).toEqual({ load_number: "A1234" });
    expect(v2.rejected_keys).toContain("driver_name");
  });
  it("every v2 field stays available in v3 for the same type", () => {
    for (const t of CANONICAL_DOCUMENT_TYPES) {
      for (const f of FIELDS_BY_TYPE[t]) expect(PAYROLL_FIELDS_BY_TYPE[t]).toContain(f);
    }
  });
});

describe("types", () => {
  it("normalises payroll aliases and stores them as existing legacy values", () => {
    expect(normalizePayrollType("Settlement")).toBe("settlement_statement");
    expect(normalizePayrollType("factoring statement")).toBe("settlement_statement");
    expect(normalizePayrollType("Pay Stub")).toBe("paystub");
    expect(normalizePayrollType("nonsense")).toBe("other");
    expect(storedDocumentType("settlement_statement")).toBe("settlement");
    expect(storedDocumentType("paystub")).toBe("paystub");
    expect(storedDocumentType("rate_confirmation")).toBe("rate_confirmation");
  });
  it("prompt asks for evidence and forbids guessing", () => {
    expect(SYSTEM_PROMPT_V3).toMatch(/source_text/);
    expect(SYSTEM_PROMPT_V3).toMatch(/Never guess/);
    expect(SYSTEM_PROMPT_V3).toMatch(/never put it in broker_mc_number/);
  });
});

describe("sanitizer: evidence, confidence, no fabrication", () => {
  it("rate con with driver/equipment + evidence", () => {
    const x = sanitizePayrollExtraction(fx.RATE_CON_OK);
    expect(x.document_type).toBe("rate_confirmation");
    expect(x.values).toMatchObject({ load_number: "SYN-10045", total_revenue: 2450, driver_name: "Test Driver One", truck_number: "T-101" });
    expect(x.fields.total_revenue).toMatchObject({ page: 1, model_confidence: "high", evidence_check: "value_in_source" });
    expect(x.missing_required).toEqual([]);
  });

  it("keeps confidence null when the model gave none (never invents one)", () => {
    const x = sanitizePayrollExtraction({ document_type: "rate_confirmation", fields: { load_number: { value: "SYN-1", source_text: "Load # SYN-1" } } });
    expect(x.model_confidence).toBeNull();
    expect(x.fields.load_number.model_confidence).toBeNull();
    const n = Object.values(x.fields).map((f) => Object.keys(f));
    expect(n.flat()).not.toContain("score");
  });

  it("flags a value that is not in its quoted text instead of repairing it", () => {
    const x = sanitizePayrollExtraction(fx.RATE_CON_BAD_EVIDENCE);
    expect(x.values.total_revenue).toBe(2540);
    expect(x.fields.total_revenue.evidence_check).toBe("value_not_in_source");
  });

  it("drops pages beyond page_count and non-integer pages", () => {
    const x = sanitizePayrollExtraction({
      document_type: "rate_confirmation", page_count: 2,
      fields: { load_number: { value: "SYN-9", page: 5, source_text: "SYN-9" }, broker_name: { value: "Acme", page: 1.5 } },
    });
    expect(x.fields.load_number.page).toBeNull();
    expect(x.fields.broker_name.page).toBeNull();
  });

  it("omits unreadable / empty values and rejects unknown keys", () => {
    const x = sanitizePayrollExtraction({
      document_type: "settlement_statement",
      fields: { net_amount: { value: "" }, gross_amount: { value: "about 2k" }, secret_field: { value: 1 } },
    });
    expect(x.values).toEqual({});
    expect(x.rejected_keys).toEqual(expect.arrayContaining(["gross_amount", "secret_field"]));
    expect(x.missing_required).toEqual(["net_amount", "statement_number|period_end"]);
  });

  it("accepts v2-shaped top-level fields (no evidence)", () => {
    const x = sanitizePayrollExtraction({ document_type: "bol", bol_number: "BOL-77", driver_name: "Test Driver One" });
    expect(x.values).toEqual({ bol_number: "BOL-77", driver_name: "Test Driver One" });
    expect(x.fields.bol_number.evidence_check).toBe("no_source");
  });

  it("settlement statement: line items, issuer, stored type", () => {
    const x = sanitizePayrollExtraction(fx.FACTORING_STATEMENT);
    expect(x.document_type).toBe("settlement_statement");
    expect(x.stored_document_type).toBe("settlement");
    expect(x.issuer).toMatchObject({ role: "factoring_company", name: "Synthetic Factoring Co" });
    expect(x.line_items).toHaveLength(4);
    expect(x.line_items[0]).toMatchObject({ kind: "load", load_number: "SYN-20001", amount: 1500, page: 1, evidence_check: "value_in_source" });
  });

  it("rejects bad line items (unknown kind, negative or non-numeric amount)", () => {
    const x = sanitizePayrollExtraction({
      document_type: "settlement_statement", fields: { net_amount: { value: 10 }, period_end: { value: "2026-10-01" } },
      line_items: [{ kind: "bonus", amount: 5 }, { kind: "deduction", amount: -5 }, { kind: "deduction", amount: "five" }, { kind: "deduction", amount: 5, source_text: "Fuel 5.00" }],
    });
    expect(x.line_items).toHaveLength(1);
    expect(x.rejected_keys).toContain("line_items[]");
  });

  it("ignores line items on types that don't have them", () => {
    const x = sanitizePayrollExtraction({ document_type: "rate_confirmation", line_items: [{ kind: "load", amount: 1 }] });
    expect(x.line_items).toEqual([]);
    expect(x.rejected_keys).toContain("line_items");
  });

  it("strips control / bidi characters from source text", () => {
    const x = sanitizePayrollExtraction({ document_type: "bol", fields: { bol_number: { value: "BOL-1", source_text: "BOL‮-1 \u0000BOL-1" } } });
    expect(x.fields.bol_number.source_text).not.toMatch(/[‮\u0000]/);
  });

  it("failed / garbage input yields an empty, low-trust result", () => {
    for (const raw of [null, "text", [], 42]) {
      const x = sanitizePayrollExtraction(raw);
      expect(x.document_type).toBe("other");
      expect(x.values).toEqual({});
      expect(x.model_confidence).toBeNull();
    }
  });
});

describe("v2-compatible view for existing routing", () => {
  it("payroll record types route as 'other' (always review)", () => {
    const v2 = toV2Compatible(sanitizePayrollExtraction(fx.FACTORING_STATEMENT));
    expect(v2.document_type).toBe("other");
    expect(v2.fields).toEqual({});
  });
  it("rate con keeps only v2 fields", () => {
    const v2 = toV2Compatible(sanitizePayrollExtraction(fx.RATE_CON_OK));
    expect(v2.fields).not.toHaveProperty("driver_name");
    expect(v2.fields).toMatchObject({ load_number: "SYN-10045", total_revenue: 2450 });
    expect(v2.missing_required).toEqual([]);
  });
});

describe("evidence matching helpers", () => {
  it("money spellings", () => {
    expect(moneySpellings(1234.5)).toEqual(expect.arrayContaining(["1234.50", "1,234.50"]));
    expect(moneySpellings(2000)).toEqual(expect.arrayContaining(["2000.00", "2,000.00", "2000", "2,000"]));
    expect(valueAppearsIn("money", 1234.5, "Total: $1,234.50")).toBe(true);
    expect(valueAppearsIn("money", 1234.5, "Total: $1,243.50")).toBe(false);
  });
  it("date spellings", () => {
    expect(dateSpellings("2026-03-07")).toEqual(expect.arrayContaining(["03/07/2026", "3/7/2026", "3/7/26", "mar 7, 2026"]));
    expect(valueAppearsIn("date", "2026-03-07", "Delivered 3/7/26 14:00")).toBe(true);
    expect(valueAppearsIn("date", "2026-03-07", "Delivered 3/8/26")).toBe(false);
  });
  it("identifiers ignore punctuation/case", () => {
    expect(valueAppearsIn("id", "SYN-10045", "Load#: syn10045")).toBe(true);
    expect(valueAppearsIn("id", "SYN-10045", "Load#: syn10054")).toBe(false);
  });
});

describe("re-reading a stored extraction is lossless", () => {
  it.each([["rate con", fx.RATE_CON_OK], ["factoring statement", fx.FACTORING_STATEMENT], ["paystub", fx.PAYSTUB_OK], ["bad evidence", fx.RATE_CON_BAD_EVIDENCE]])("%s: sanitize(sanitize(x)) === sanitize(x)", (_n, raw) => {
    const once = sanitizePayrollExtraction(raw);
    const stored = JSON.parse(JSON.stringify({ ...once, parse_stage: "strict", type_hint: null }));
    const twice = sanitizePayrollExtraction(stored);
    expect(twice.fields).toEqual(once.fields);
    expect(twice.values).toEqual(once.values);
    expect(twice.line_items).toEqual(once.line_items);
    expect(twice.issuer).toEqual(once.issuer);
    expect(twice.model_confidence).toEqual(once.model_confidence);
    expect(twice.document_type).toBe(once.document_type);
    expect(twice.missing_required).toEqual(once.missing_required);
  });
});
