import { describe, expect, it } from "vitest";
import {
  buildV2UserContent,
  checkV2File,
  estimatePdfPageCount,
  looksLikePdf,
  sanitizeExtraction,
  SYSTEM_PROMPT_V2,
  V2_MAX_PDF_PAGES,
} from "./extraction";

const enc = (s: string) => new TextEncoder().encode(s);

describe("v2 file checks (PDF support)", () => {
  it("accepts PDFs by MIME or extension", () => {
    expect(checkV2File("application/pdf", "a/x.pdf", 50_000)).toEqual({ ok: true, kind: "pdf", mime: "application/pdf" });
    expect(checkV2File("", "a/x.PDF", 50_000)).toMatchObject({ ok: true, kind: "pdf" });
  });
  it("accepts supported images, rejects HEIC with a clear reason", () => {
    expect(checkV2File("image/jpeg", "a/x.jpg", 50_000)).toMatchObject({ ok: true, kind: "image" });
    expect(checkV2File("image/heic", "a/x.heic", 50_000)).toEqual({ ok: false, reason: "heic_not_supported" });
  });
  it("enforces size bounds", () => {
    expect(checkV2File("application/pdf", "a/x.pdf", 10)).toMatchObject({ ok: false });
    expect(checkV2File("application/pdf", "a/x.pdf", 21 * 1024 * 1024)).toMatchObject({ ok: false });
  });
  it("detects PDF magic and estimates pages", () => {
    const pdf = enc("%PDF-1.7\n1 0 obj << /Type /Pages /Count 2 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type/Page >>\n");
    expect(looksLikePdf(pdf)).toBe(true);
    expect(looksLikePdf(enc("<html>"))).toBe(false);
    expect(estimatePdfPageCount(pdf)).toBe(2);
    expect(estimatePdfPageCount(enc("%PDF-1.7 compressed only"))).toBeNull();
    expect(V2_MAX_PDF_PAGES).toBeGreaterThanOrEqual(10);
  });
});

describe("provider payload", () => {
  it("sends PDFs as a Chat Completions file part (multi-page, no Files API)", () => {
    const parts = buildV2UserContent("pdf", "application/pdf", "QUJD", null);
    expect(parts[1]).toEqual({ type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64,QUJD" } });
  });
  it("sends images as image_url with high detail", () => {
    const parts = buildV2UserContent("image", "image/png", "QUJD", "bol");
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD", detail: "high" } });
    expect((parts[0] as { text: string }).text).toContain('"bol"');
  });
  it("the prompt forbids guessing and lists every canonical type", () => {
    expect(SYSTEM_PROMPT_V2).toMatch(/Never guess/);
    for (const t of ["rate_confirmation", "bol", "pod", "fuel_receipt", "lumper_fee", "toll", "repair", "cdl", "medical_card", "mvr", "other"]) {
      expect(SYSTEM_PROMPT_V2).toContain(`"${t}"`);
    }
  });
});

describe("classification per canonical type", () => {
  it.each([
    ["rate_confirmation", { load_number: "RC-1", broker_name: "TQL", total_revenue: 2400 }],
    ["bol", { bol_number: "BOL-99", shipper_name: "Acme" }],
    ["pod", { load_number: "RC-1", signature_present: true }],
    ["fuel_receipt", { vendor_name: "Pilot", expense_amount: 412.18, receipt_date: "2026-09-29", gallons: 101 }],
    ["lumper_fee", { vendor_name: "Capstone", expense_amount: 250, receipt_date: "2026-09-29" }],
    ["toll", { vendor_name: "NTTA", expense_amount: 18.4, receipt_date: "2026-09-29" }],
    ["repair", { vendor_name: "TA Truck Service", expense_amount: 980, receipt_date: "2026-09-29", description: "Brake job" }],
    ["cdl", { person_name: "Jane Roe", license_state: "nm", expiration_date: "2029-01-31" }],
    ["medical_card", { person_name: "Jane Roe", expiration_date: "2027-06-30", exam_date: "2025-06-30" }],
    ["mvr", { person_name: "Jane Roe", license_state: "NM", report_date: "2026-09-01" }],
  ])("%s keeps its own fields and is complete", (type, fields) => {
    const s = sanitizeExtraction({ document_type: type, confidence: "high", ...fields });
    expect(s.document_type).toBe(type);
    expect(s.missing_required).toEqual([]);
    expect(Object.keys(s.fields).sort()).toEqual(Object.keys(fields).sort());
    if (type === "cdl") expect(s.fields.license_state).toBe("NM");
  });

  it("unknown document -> other, no fields", () => {
    const s = sanitizeExtraction({ document_type: "passport", confidence: "high", person_name: "X Y" });
    expect(s.document_type).toBe("other");
    expect(s.fields).toEqual({});
    expect(s.rejected_keys).toContain("person_name");
  });

  it("reports missing required fields instead of inventing them", () => {
    const s = sanitizeExtraction({ document_type: "fuel_receipt", confidence: "high", vendor_name: "Pilot" });
    expect(s.missing_required).toEqual(["expense_amount", "receipt_date"]);
    expect(s.fields.expense_amount).toBeUndefined();
  });
});

describe("untrusted / malicious extracted values", () => {
  it("rejects injection-shaped identifiers, control characters and bidi overrides", () => {
    const s = sanitizeExtraction({
      document_type: "rate_confirmation",
      confidence: "high",
      load_number: "1001'); drop table loads;--",
      broker_name: "TQL\u202e\u0000 Logistics",
      origin: "<script>alert(1)</script>",
      total_revenue: 2400,
    });
    expect(s.fields.load_number).toBeUndefined();
    expect(s.rejected_keys).toContain("load_number");
    expect(s.fields.broker_name).toBe("TQL Logistics");
    expect(typeof s.fields.origin).toBe("string"); // plain text, React escapes on render
  });

  it("rejects negative / absurd / non-finite numbers and impossible dates", () => {
    const s = sanitizeExtraction({
      document_type: "fuel_receipt",
      confidence: "high",
      vendor_name: "Pilot",
      expense_amount: -50,
      gallons: 1e9,
      price_per_gallon: "NaN",
      receipt_date: "2026-02-30",
    });
    expect(s.fields).toEqual({ vendor_name: "Pilot" });
    expect(s.rejected_keys).toEqual(expect.arrayContaining(["expense_amount", "gallons", "price_per_gallon", "receipt_date"]));
  });

  it("drops fields that do not belong to the type and prototype keys", () => {
    const raw = JSON.parse('{"document_type":"toll","confidence":"high","vendor_name":"NTTA","expense_amount":5,"receipt_date":"2026-09-01","license_number":"D1","__proto__":{"polluted":true},"driver_id":"x"}');
    const s = sanitizeExtraction(raw);
    expect(s.fields.license_number).toBeUndefined();
    expect((s.fields as Record<string, unknown>).driver_id).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("an invalid confidence label becomes null (not high)", () => {
    expect(sanitizeExtraction({ document_type: "toll", confidence: "VERY HIGH!!" }).model_confidence).toBeNull();
    expect(sanitizeExtraction("not an object").document_type).toBe("other");
  });

  it("accepts money as '$1,234.50' strings but not words", () => {
    const s = sanitizeExtraction({ document_type: "repair", confidence: "high", vendor_name: "TA", expense_amount: "$1,234.50", receipt_date: "2026-09-01" });
    expect(s.fields.expense_amount).toBe(1234.5);
    expect(sanitizeExtraction({ document_type: "repair", expense_amount: "about 50" }).fields.expense_amount).toBeUndefined();
  });
});
