// =============================================================================
//  loads write contract — columns production actually has
// -----------------------------------------------------------------------------
//  Source of truth: supabase/schema-contract/loads.columns.json (captured
//  read-only from production information_schema). lib/loads/schema.test.ts
//  fails if this list and that file drift apart.
//
//  Every web write to `loads` passes through `assertLoadColumns`, so a payload
//  that names a column production doesn't have fails here, loudly, with the
//  column name — instead of as a PostgREST "column not found" at runtime.
// =============================================================================

export const LOADS_PRODUCTION_COLUMNS = [
  "id", "profile_id", "driver_id", "load_number", "broker_name",
  "broker_mc_number", "pickup_date", "delivery_date", "origin",
  "destination", "total_miles", "line_haul_rate", "fuel_surcharge",
  "accessorial_charges", "total_revenue", "status", "created_at",
  "updated_at", "truck_id", "trailer_id", "weight_value", "weight_unit",
  "dispatch_thread_id", "dispatch_load_offer_id", "dispatcher_name",
  "dispatcher_company", "empty_miles", "driver_pay_type",
  "driver_percentage", "driver_rate_per_mile", "driver_gross_pay",
  "loaded_miles", "gross_load_pay", "pay_type",
] as const;

export type LoadsColumn = (typeof LOADS_PRODUCTION_COLUMNS)[number];

const KNOWN = new Set<string>(LOADS_PRODUCTION_COLUMNS);

export class UnknownLoadColumnError extends Error {
  constructor(public readonly columns: string[], context: string) {
    super(`${context}: loads has no column(s) ${columns.join(", ")}`);
  }
}

export function unknownLoadColumns(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((k) => !KNOWN.has(k));
}

/** Throws if `row` names any column production `loads` lacks. Returns it typed. */
export function assertLoadColumns<T extends Record<string, unknown>>(row: T, context: string): T {
  const bad = unknownLoadColumns(row);
  if (bad.length) throw new UnknownLoadColumnError(bad, context);
  return row;
}
