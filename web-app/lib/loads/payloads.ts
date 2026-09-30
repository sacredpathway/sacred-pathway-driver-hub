// =============================================================================
//  Load write payload builders (pure — no Supabase, no Next)
// -----------------------------------------------------------------------------
//  Every key produced here is a real production `loads` column; broker rep
//  details are returned SEPARATELY for lib/brokers/contact.ts, because
//  production stores them in brokers / broker_contacts, not on loads.
//  lib/loads/payloads.test.ts proves both against the schema contract.
// =============================================================================

import { date, maybeUuid, num, s } from "./formFields";
import { NEW_LOAD_STATUS } from "./status";
import type { BrokerContactInput } from "@/lib/brokers/contact";

export interface CreateLoadPayload {
  load_number: string | null;
  broker_name: string | null;
  broker_mc_number: string | null;
  origin: string | null;
  destination: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  total_miles: number | null;
  line_haul_rate: number | null;
  fuel_surcharge: number | null;
  accessorial_charges: number | null;
  total_revenue: number | null;
  status: string;
  driver_id: string | null;
  truck_id: string | null;
  trailer_id: string | null;
}

export interface BuiltCreateLoad {
  payload: CreateLoadPayload;
  brokerContact: BrokerContactInput;
}

/**
 * Throws FieldError on invalid input (same messages as before).
 *
 * Status is NOT read from the form: an entered load is a delivered load, so
 * every new load is saved with NEW_LOAD_STATUS (see lib/loads/status.ts).
 * Any `status` field in the submission is ignored.
 */
export function buildCreateLoadPayload(formData: FormData): BuiltCreateLoad {
  const payload: CreateLoadPayload = {
    load_number:         s(formData, "load_number"),
    broker_name:         s(formData, "broker_name"),
    broker_mc_number:    s(formData, "broker_mc_number"),
    origin:              s(formData, "origin"),
    destination:         s(formData, "destination"),
    pickup_date:         date(formData, "pickup_date"),
    delivery_date:       date(formData, "delivery_date"),
    total_miles:         num(formData, "total_miles",         { nonNegative: true, label: "Miles" }),
    line_haul_rate:      num(formData, "line_haul_rate",      { nonNegative: true, label: "Line haul" }),
    fuel_surcharge:      num(formData, "fuel_surcharge",      { nonNegative: true, label: "Fuel surcharge" }),
    accessorial_charges: num(formData, "accessorial_charges", { nonNegative: true, label: "Accessorials" }),
    total_revenue:       num(formData, "total_revenue",       { nonNegative: true, label: "Total revenue" }),
    status:              NEW_LOAD_STATUS,
    driver_id:           maybeUuid(formData, "driver_id",  "Driver"),
    truck_id:            maybeUuid(formData, "truck_id",   "Truck"),
    trailer_id:          maybeUuid(formData, "trailer_id", "Trailer"),
  };

  // Auto-compute total_revenue if the carrier filled the components but
  // left total blank. Mirrors iOS scan behavior.
  if (payload.total_revenue === null) {
    const parts =
      (payload.line_haul_rate      ?? 0) +
      (payload.fuel_surcharge      ?? 0) +
      (payload.accessorial_charges ?? 0);
    if (parts > 0) payload.total_revenue = Math.round(parts * 100) / 100;
  }

  return {
    payload,
    brokerContact: {
      brokerName:     payload.broker_name,
      mcNumber:       payload.broker_mc_number,
      contactName:    s(formData, "broker_contact_name"),
      phone:          s(formData, "broker_contact_phone"),
      phoneExtension: s(formData, "broker_phone_extension"),
      email:          s(formData, "broker_contact_email"),
    },
  };
}
