import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ refreshPayrollProposalAction: vi.fn(), confirmPayrollDraftAction: vi.fn() }));

import PayrollReview from "./PayrollReview";
import { buildPayrollProposal } from "@/lib/payrollUpload/proposal";
import { payrollConfirmGate } from "@/lib/payrollUpload/featureFlag";
import * as fx from "@/lib/payrollUpload/fixtures";
import { DOC, NEW_DRAFT, doc, input } from "@/lib/payrollUpload/proposal.test-helpers";

const OFF = payrollConfirmGate({});
const LOCAL = payrollConfirmGate({ SMART_PAYROLL_CONFIRM: "local-only", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
const render = (p: ReturnType<typeof buildPayrollProposal>, gate = OFF, mime = "image/jpeg") =>
  renderToStaticMarkup(<PayrollReview documentId={DOC} initial={p} previewUrl="https://signed.example/doc" previewMime={mime} gate={gate} />).replace(/<!-- -->/g, "");

describe("PayrollReview", () => {
  it("shows evidence: page, quoted text, the model's own confidence label, and the load record side by side", () => {
    const html = render(buildPayrollProposal(input()));
    expect(html).toContain("Total carrier pay");
    expect(html).toContain("Page 1");
    expect(html).toContain("Total Carrier Pay $2,450.00");
    expect(html).toContain("Model confidence: high");
    expect(html).toContain("Found in quoted text");
    expect(html).toContain('data-field="total_revenue" data-compare="match"');
    expect(html).toContain("draft line gross $2450.00 (from your load record)");
    expect(html).toContain("Original document");
  });
  it("conflicts are flagged and must be confirmed", () => {
    const raw = { ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, line_haul_rate: { value: 2250, source_text: "Line Haul $2,250.00" }, total_revenue: { value: 2500, source_text: "Total Carrier Pay $2,500.00" } } };
    const html = render(buildPayrollProposal(input({ document: doc(raw), decisions: { target: NEW_DRAFT } })));
    expect(html).toContain('data-field="total_revenue" data-compare="conflict"');
    expect(html).toContain("The draft will use your load record");
    expect(html).toContain('data-testid="warnings"');
  });
  it("missing values and blockers are listed", () => {
    const raw = { document_type: "rate_confirmation", confidence: "low", fields: { load_number: { value: "SYN-10045", source_text: "SYN-10045" } } };
    const html = render(buildPayrollProposal(input({ document: doc(raw) })));
    expect(html).toContain('data-testid="missing"');
    expect(html).toContain('data-testid="blockers"');
    expect(html).toContain("Model confidence: not given");
  });
  it("owner corrections are shown with the value originally read", () => {
    const html = render(buildPayrollProposal(input({ document: doc(fx.RATE_CON_BAD_EVIDENCE), decisions: { corrections: { total_revenue: { value: "2450.00" } } } })));
    expect(html).toContain("read as $2540.00");
    expect(html).toContain("Corrected by you");
  });
  it("statements are reference only: banner, no confirm button, no correction controls", () => {
    const html = render(buildPayrollProposal(input({ document: doc(fx.OWN_STATEMENT) })), LOCAL);
    expect(html).toContain('data-testid="reference-banner"');
    expect(html).not.toContain('data-testid="confirm"');
    expect(html).not.toContain("Correct misread");
    expect(html).toContain("Statement lines (reference only)");
  });
  it("confirm is disabled when the gate is off, even when the proposal is ready", () => {
    const p = buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } }));
    expect(p.canConfirm).toBe(true);
    const html = render(p, OFF);
    expect(html).toMatch(/data-testid="confirm"[^>]*disabled=""/);
    expect(html).toContain("turned off in this environment");
  });
  it("confirm is enabled only with the local gate AND a ready proposal; it prepares a draft only", () => {
    const html = render(buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } })), LOCAL);
    expect(html).not.toMatch(/data-testid="confirm"[^>]*disabled=""/);
    expect(html).toContain("Prepare draft settlement");
    expect(html).toContain("Prepares a draft only");
    expect(render(buildPayrollProposal(input()), LOCAL)).toMatch(/data-testid="confirm"[^>]*disabled=""/);
  });
  it("PDFs preview in a frame", () => {
    expect(render(buildPayrollProposal(input()), OFF, "application/pdf")).toContain("<iframe");
  });
  it("never offers approve / finalize / pay", () => {
    const html = render(buildPayrollProposal(input({ decisions: { target: NEW_DRAFT } })), LOCAL);
    expect(html).not.toMatch(/approve|finalize settlement|mark paid|pay now/i);
  });
});

describe("no approval / payment path anywhere in Smart Payroll Upload", () => {
  const dirs = [__dirname, join(__dirname, "..", "..", "..", "..", "..", "lib", "payrollUpload")];
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(ts|tsx)$/.test(f) && !/test/.test(f)).map((f) => join(d, f)));
  it.each(files)("%s", (f) => {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/sph_web_transition_settlement|transitionSettlementAction|transitionSettlementAtomic|issue_paystub|void_paystub|sph_web_save_settlement/);
    expect(src).not.toMatch(/(?<![a-z_])status:\s*["'](approved|paid)["']/);
    expect(src).not.toMatch(/\.from\(["'](settlements|settlement_loads|settlement_additions|settlement_deductions|loads|paystubs)["']\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/);
  });
});
