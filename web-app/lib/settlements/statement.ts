// =============================================================================
//  Paystub (settlement statement) sections
// -----------------------------------------------------------------------------
//  Every deduction entered on a settlement appears on the paystub:
//    * driver-paid (and the driver share of a split)  -> "Deductions", reduces net pay
//    * company-paid (and the company share of a split, and company fees from the
//      pay terms: dispatcher / factoring / authority / maintenance reserve)
//      -> "Paid by the company", shown for the record, does NOT change net pay
//  Net pay is unchanged — this only decides what is printed.
// =============================================================================

import { Money } from "@/lib/money/money";
import type { CalcResult, LineItem } from "./engine";

export interface StatementSections {
  settlementEarnings: LineItem[];
  additions: LineItem[];
  driverDeductions: LineItem[];
  companyPaid: LineItem[];
  companyPaidTotal: Money;
}

export function statementSections(r: CalcResult): StatementSections {
  const of = (k: LineItem["kind"]) => r.lineItems.filter((l) => l.kind === k);
  const companyPaid = of("companyExpense");
  return {
    settlementEarnings: of("settlementEarning"),
    additions: of("addition"),
    driverDeductions: of("driverDeduction"),
    companyPaid,
    companyPaidTotal: Money.sum(companyPaid.map((l) => l.amount)),
  };
}
