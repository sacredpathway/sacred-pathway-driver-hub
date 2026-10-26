// =============================================================================
//  SYNTHETIC test fixtures for Smart Payroll Upload.
//  These imitate MODEL OUTPUT (the JSON the extractor returns). Every name,
//  number, company and MC below is invented; none is a real customer record.
// =============================================================================

const ev = (value: unknown, source_text: string, page = 1, confidence = "high") => ({ value, page, source_text, confidence });

export const OWN_COMPANY = { names: ["Synthetic Haul LLC"], mcNumbers: ["MC 900001"] };

export const RATE_CON_OK = {
  document_type: "rate_confirmation",
  confidence: "high",
  page_count: 2,
  fields: {
    load_number: ev("SYN-10045", "Load # SYN-10045"),
    broker_name: ev("Example Brokerage Inc", "Broker: Example Brokerage Inc"),
    broker_mc_number: ev("800123", "Broker MC# 800123"),
    carrier_name: ev("Synthetic Haul LLC", "Carrier: Synthetic Haul LLC"),
    carrier_mc_number: ev("900001", "Carrier MC 900001"),
    origin: ev("Dallas, TX", "Pickup: Dallas, TX"),
    destination: ev("Houston, TX", "Deliver: Houston, TX"),
    pickup_date: ev("2026-10-12", "PU 10/12/2026"),
    delivery_date: ev("2026-10-13", "DEL 10/13/2026"),
    line_haul_rate: ev(2200, "Line Haul $2,200.00"),
    fuel_surcharge: ev(200, "FSC $200.00"),
    accessorial_charges: ev(50, "Detention $50.00", 2),
    total_revenue: ev(2450, "Total Carrier Pay $2,450.00"),
    driver_name: ev("Test Driver One", "Driver: Test Driver One", 1, "medium"),
    truck_number: ev("T-101", "Truck T-101"),
  },
  notes: "",
};

/** total_revenue read as 2540 but the quoted text says 2,450.00 */
export const RATE_CON_BAD_EVIDENCE = {
  ...RATE_CON_OK,
  fields: { ...RATE_CON_OK.fields, total_revenue: ev(2540, "Total Carrier Pay $2,450.00") },
};

/** Components (2200 + 200 + 50 = 2450) disagree with the printed total 2500. */
export const RATE_CON_SUM_MISMATCH = {
  ...RATE_CON_OK,
  fields: { ...RATE_CON_OK.fields, total_revenue: ev(2500, "Total Carrier Pay $2,500.00") },
};

/** Another carrier's rate con (their MC, not ours). */
export const RATE_CON_OTHER_CARRIER = {
  ...RATE_CON_OK,
  fields: {
    ...RATE_CON_OK.fields,
    carrier_name: ev("Different Carrier Corp", "Carrier: Different Carrier Corp"),
    carrier_mc_number: ev("777777", "MC 777777"),
  },
};

/** gross 2700 = 1500 + 1200; deductions 81 + 300 = 381; net 2319. */
export const FACTORING_STATEMENT = {
  document_type: "settlement_statement",
  confidence: "high",
  page_count: 1,
  issuer: { name: "Synthetic Factoring Co", role: "factoring_company", page: 1, source_text: "Synthetic Factoring Co — Remittance" },
  fields: {
    statement_number: ev("REM-5501", "Remittance # REM-5501"),
    payee_name: ev("Synthetic Haul LLC", "Pay to: Synthetic Haul LLC"),
    period_start: ev("2026-10-05", "Period 10/05/2026"),
    period_end: ev("2026-10-11", "through 10/11/2026"),
    gross_amount: ev(2700, "Gross $2,700.00"),
    total_deductions: ev(381, "Total Deductions $381.00"),
    net_amount: ev(2319, "Net Remitted $2,319.00"),
  },
  line_items: [
    { kind: "load", load_number: "SYN-20001", description: "Load SYN-20001", date: "2026-10-06", amount: 1500, page: 1, source_text: "SYN-20001 ... $1,500.00", confidence: "high" },
    { kind: "load", load_number: "SYN-20002", description: "Load SYN-20002", date: "2026-10-09", amount: 1200, page: 1, source_text: "SYN-20002 ... $1,200.00", confidence: "high" },
    { kind: "deduction", description: "Factoring fee 3%", amount: 81, page: 1, source_text: "Factoring fee $81.00", confidence: "high" },
    { kind: "deduction", description: "Fuel advance", amount: 300, page: 1, source_text: "Fuel advance $300.00", confidence: "medium" },
  ],
  notes: "",
};

/** Net printed 2391 — does not equal 2700 − 381. */
export const STATEMENT_NET_MISMATCH = {
  ...FACTORING_STATEMENT,
  fields: { ...FACTORING_STATEMENT.fields, net_amount: ev(2391, "Net Remitted $2,391.00") },
};

/** Same load twice with different amounts. */
export const STATEMENT_CONFLICTING_LINES = {
  ...FACTORING_STATEMENT,
  line_items: [
    ...FACTORING_STATEMENT.line_items,
    { kind: "load", load_number: "syn 20001", amount: 1550, page: 1, source_text: "SYN-20001 $1,550.00" },
  ],
};

export const OWN_STATEMENT = {
  ...FACTORING_STATEMENT,
  issuer: { name: "Synthetic Haul LLC", role: "our_company", mc_number: "MC900001", page: 1, source_text: "Synthetic Haul LLC Driver Settlement" },
};

export const EXTERNAL_CARRIER_STATEMENT = {
  ...FACTORING_STATEMENT,
  issuer: { name: "Different Carrier Corp", role: "external_carrier", page: 1, source_text: "Different Carrier Corp" },
};

export const UNKNOWN_ISSUER_STATEMENT = { ...FACTORING_STATEMENT, issuer: undefined };

/** gross 1800 − deductions 412.35 = 1387.65 */
export const PAYSTUB_OK = {
  document_type: "paystub",
  confidence: "medium",
  page_count: 1,
  issuer: { name: "Synthetic Haul LLC", role: "our_company", page: 1, source_text: "Synthetic Haul LLC" },
  fields: {
    employer_name: ev("Synthetic Haul LLC", "Synthetic Haul LLC"),
    employee_name: ev("Test Driver Two", "Employee: Test Driver Two"),
    period_start: ev("2026-09-28", "09/28/2026"),
    period_end: ev("2026-10-04", "10/04/2026"),
    check_date: ev("2026-10-08", "Check Date 10/08/2026"),
    gross_pay: ev(1800, "Gross Pay 1,800.00"),
    total_deductions: ev(412.35, "Total Deductions 412.35"),
    net_pay: ev(1387.65, "Net Pay 1,387.65"),
  },
  line_items: [
    { kind: "earning", description: "Hourly", amount: 1800, source_text: "Regular 1,800.00" },
    { kind: "tax", description: "Federal", amount: 210.0, source_text: "Fed 210.00" },
    { kind: "tax", description: "FICA", amount: 137.7, source_text: "FICA 137.70" },
    { kind: "deduction", description: "Uniform", amount: 64.65, source_text: "Uniform 64.65" },
  ],
};

export const BOL_POD = {
  document_type: "pod",
  confidence: "high",
  fields: {
    bol_number: ev("BOL-88231", "BOL# BOL-88231"),
    load_number: ev("SYN-10045", "Ref SYN-10045"),
    delivery_date: ev("2026-10-13", "Delivered 10/13/26"),
    signature_present: ev(true, "signature"),
  },
};

export const FUEL_RECEIPT = {
  document_type: "fuel_receipt",
  confidence: "high",
  fields: {
    vendor_name: ev("Example Fuel Stop", "EXAMPLE FUEL STOP #12"),
    expense_amount: ev(412.88, "TOTAL $412.88"),
    receipt_date: ev("2026-10-12", "10/12/2026"),
    receipt_number: ev("R-55821", "Trans R-55821"),
  },
};
