// =============================================================================
//  Expense constants — Carrier HQ
// -----------------------------------------------------------------------------
//  Non-server module. Mirrors iOS AddEditExpenseView's hard-coded picker so
//  the two clients agree on the canonical category set. The server action
//  file imports from here; the client form does too.
// =============================================================================

export const EXPENSE_CATEGORIES: ReadonlyArray<string> = [
  "fuel",
  "toll",
  "lumper",
  "maintenance",
  "repair",
  "insurance",
  "permit",
  "scale",
  "parking",
  "meal",
  "factoring",
  "dispatch",
  "office",
  "other",
] as const;
