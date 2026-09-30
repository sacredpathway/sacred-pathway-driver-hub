import { describe, expect, it } from "vitest";
import {
  INTEGRITY_CODES,
  INTEGRITY_UNAVAILABLE,
  conflictMessage,
  integrityCode,
  integrityMessage,
  isMissingFunction,
} from "./integrity";
import { calculatePaystub, seedContractorLines } from "./engine";

describe("integrity reason codes", () => {
  it("recognises every code the migration raises", () => {
    const sql = [
      "load_not_found", "load_cancelled", "load_settled", "load_on_issued_paystub", "load_on_settlement",
      "paystub_locked", "paystub_not_found", "paystub_not_draft", "paystub_not_voidable",
      "paystub_invalid_transition", "not_authenticated",
    ];
    expect([...INTEGRITY_CODES].sort()).toEqual(sql.sort());
    for (const c of sql) expect(integrityCode({ message: c })).toBe(c);
  });

  it("parses codes followed by detail text", () => {
    expect(integrityCode({ message: "paystub_locked: load lines can only be removed from a draft paystub" })).toBe("paystub_locked");
    expect(integrityCode({ message: "paystub_invalid_transition: draft -> paid" })).toBe("paystub_invalid_transition");
  });

  it("does not confuse a longer code with a shorter prefix", () => {
    expect(integrityCode({ message: "load_on_issued_paystub" })).toBe("load_on_issued_paystub");
    expect(integrityCode({ message: "paystub_not_draft" })).toBe("paystub_not_draft");
  });

  it("falls back to the raw message for unknown errors", () => {
    expect(integrityCode({ message: "duplicate key value" })).toBeNull();
    expect(integrityMessage({ message: "duplicate key value" })).toBe("duplicate key value");
  });

  it("labels load conflicts with the load number", () => {
    expect(integrityMessage({ message: "load_settled" }, "Load #2841")).toBe(
      "Load #2841: This load is already settled — it was paid on another paystub or settlement.",
    );
    expect(conflictMessage("load_on_settlement", "Load #7")).toMatch(/^Load #7: .*iPhone/);
    expect(integrityMessage({ message: "paystub_not_draft" }, "Load #7")).toBe("Only draft paystubs can be issued.");
  });

  it("reports a missing RPC (migration not applied) without pretending success", () => {
    const e = { code: "PGRST202", message: "Could not find the function public.issue_paystub(p_paystub_id) in the schema cache" };
    expect(isMissingFunction(e)).toBe(true);
    expect(integrityMessage(e)).toBe(INTEGRITY_UNAVAILABLE);
  });
});

describe("pay calculations are unchanged (golden values)", () => {
  it("1099: gross + additions − settlement deductions − post-tax", () => {
    const t = calculatePaystub({
      worker_type: "1099",
      earnings: [{ amount: 2500.1, is_taxable: true }, { amount: 1199.9, is_taxable: true }],
      deductions: [{ amount: 50, is_pre_tax: false }],
      taxes: [],
      settlement_items: [
        { amount: 75.25, direction: "add" },
        { amount: 400, direction: "deduct" },
        { amount: 120.5, direction: "deduct" },
      ],
    });
    expect(t).toEqual({
      gross_earnings: 3700,
      total_pretax_deductions: 0,
      taxable_wages: null,
      total_taxes_withheld: 0,
      total_employer_taxes: 0,
      total_posttax_deductions: 50,
      total_reimbursements: 75.25,
      total_settlement_deductions: 520.5,
      net_pay: 3204.75,
    });
  });

  it("W2: taxable = gross − pre-tax − non-taxable; net = gross − pre-tax − employee taxes − post-tax", () => {
    const t = calculatePaystub({
      worker_type: "W2",
      earnings: [{ amount: 1600, is_taxable: true }, { amount: 100, is_taxable: false }],
      deductions: [{ amount: 80, is_pre_tax: true }, { amount: 20, is_pre_tax: false }],
      taxes: [{ employee_amount: 150.33, employer_amount: 122.4 }],
      settlement_items: [],
    });
    expect(t.gross_earnings).toBe(1700);
    expect(t.taxable_wages).toBe(1520);
    expect(t.total_taxes_withheld).toBe(150.33);
    expect(t.total_employer_taxes).toBe(122.4);
    expect(t.net_pay).toBe(1449.67);
  });

  it("seeds one settlement_gross line per load at its total_revenue", () => {
    const seed = seedContractorLines([
      { id: "l1", load_number: "2841", origin: "Dallas, TX", destination: "Tulsa, OK", total_revenue: 1850.5, total_miles: 257 },
    ]);
    expect(seed.earnings).toEqual([
      {
        kind: "settlement_gross", label: "Load #2841  Dallas, TX → Tulsa, OK", amount: 1850.5,
        is_taxable: true, hours: null, units: 257, rate: null, load_id: "l1", notes: null,
      },
    ]);
  });
});
