// =============================================================================
//  Automatic load creation from a rate confirmation (pure; owner decision
//  2026-10-25: allowed only when EVERYTHING is verified, otherwise review)
// -----------------------------------------------------------------------------
//  A load is created without a click only when all of these hold:
//    * the document is a rate confirmation read with the v3 payroll profile,
//      cleanly parsed, labelled "high" by the model, never corrected by hand,
//      not a duplicate upload, and with no upload type-hint disagreement;
//    * CARRIER: the carrier printed on it is this account (MC or name match
//      against the verified profile identity) — never someone else's load;
//    * DRIVER: the printed driver matches exactly one active driver by full
//      name (a wrong driver = wrong person paid, so no fuzzy match);
//    * LOAD IDENTITY: a load number is printed and NO load of this account
//      already carries it (any status) — otherwise it's an attach, a conflict
//      or a duplicate, never a second load;
//    * DATES: pickup and delivery printed, in order, not absurdly old/future;
//    * MONEY: total carrier pay printed and > $0, components add up, and every
//      money/date/id value is found in the text quoted for it (no validation
//      error or warning at all);
//    * broker, origin and destination printed.
//  Anything missing or doubtful returns the reasons; the document then stays
//  in review with the pre-filled "Create load" card, exactly as before.
// =============================================================================

import { matchDriver, normalizeIdentifier } from "./matching";
import type { SanitizedPayrollExtraction } from "./payrollExtraction";
import type { DriverCandidate, LoadCandidate } from "./types";
import { isOwnCompany } from "../payrollUpload/policy";
import type { CarrierIdentity } from "../payrollUpload/carrierIdentity";
import { validatePayrollExtraction } from "../payrollUpload/validation";

export type AutoCreateReason =
  | "not_v3" | "parse_failed" | "not_rate_confirmation" | "not_high_confidence" | "human_corrected" | "duplicate_upload"
  | "type_hint_mismatch" | "identity_unverified" | "carrier_not_ours" | "carrier_not_printed"
  | "no_driver_printed" | "driver_not_unique" | "driver_inactive" | "no_load_number" | "load_number_exists"
  | "missing_fields" | "dates_invalid" | "no_revenue" | "validation";

export const AUTO_CREATE_REASON_TEXT: Readonly<Record<AutoCreateReason, string>> = {
  not_v3: "Not read with the payroll profile.",
  parse_failed: "The AI response could not be fully understood.",
  not_rate_confirmation: "Not a rate confirmation.",
  not_high_confidence: "The AI was not highly confident about this document.",
  human_corrected: "Values were corrected by hand.",
  duplicate_upload: "Same file was uploaded before.",
  type_hint_mismatch: "The AI's type disagrees with the type chosen at upload.",
  identity_unverified: "Your company name / MC isn't on your profile, so the carrier can't be checked.",
  carrier_not_ours: "The carrier on the rate confirmation isn't your company.",
  carrier_not_printed: "No carrier name or MC is printed.",
  no_driver_printed: "No driver is printed, so the load can't be assigned automatically.",
  driver_not_unique: "The printed driver doesn't match exactly one of your drivers.",
  driver_inactive: "The printed driver is inactive.",
  no_load_number: "No load number is printed.",
  load_number_exists: "One of your loads already has this load number.",
  missing_fields: "Broker, origin, destination, pickup or delivery is missing.",
  dates_invalid: "Pickup/delivery dates are out of order or out of range.",
  no_revenue: "Total carrier pay is missing or $0.00.",
  validation: "Amounts or quoted text didn't check out.",
};

export interface AutoCreateInput {
  extraction: SanitizedPayrollExtraction;
  parseStage: string | null;
  humanCorrected: boolean;
  duplicateOf: string | null;
  typeHintMismatch: boolean;
  identity: CarrierIdentity | null;
  ownerId: string;
  drivers: readonly DriverCandidate[];
  /** Loads whose number may normalise to the printed one (any status). */
  loads: readonly LoadCandidate[];
  today: string;
}

export interface LoadDraftRow {
  load_number: string;
  broker_name: string;
  broker_mc_number: string | null;
  origin: string;
  destination: string;
  pickup_date: string;
  delivery_date: string;
  total_miles: number | null;
  line_haul_rate: number | null;
  fuel_surcharge: number | null;
  accessorial_charges: number | null;
  total_revenue: number;
  driver_id: string;
}

export type AutoCreateDecision =
  | { eligible: true; row: LoadDraftRow; driverName: string }
  | { eligible: false; reasons: AutoCreateReason[] };

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function decideAutoCreateLoad(x: AutoCreateInput): AutoCreateDecision {
  const e = x.extraction;
  const v = e.values;
  const r: AutoCreateReason[] = [];
  const add = (k: AutoCreateReason) => { if (!r.includes(k)) r.push(k); };

  if (e.extraction_version !== "v3") add("not_v3");
  if (x.parseStage === "fallback") add("parse_failed");
  if (e.document_type !== "rate_confirmation") return { eligible: false, reasons: [...r, "not_rate_confirmation"] };
  if (e.model_confidence !== "high") add("not_high_confidence");
  if (x.humanCorrected) add("human_corrected");
  if (x.duplicateOf) add("duplicate_upload");
  if (x.typeHintMismatch) add("type_hint_mismatch");

  // Carrier = us.
  if (!x.identity || !x.identity.verified) add("identity_unverified");
  else {
    const ours = isOwnCompany(v.carrier_name, v.carrier_mc_number, x.identity);
    if (ours === null) add("carrier_not_printed");
    else if (ours === false) add("carrier_not_ours");
  }

  // Load identity: printed, and not already one of ours.
  const loadNumber = str(v.load_number);
  const key = normalizeIdentifier(loadNumber);
  if (!loadNumber || !key) add("no_load_number");
  else if (x.loads.some((l) => l.profile_id === x.ownerId && normalizeIdentifier(l.load_number) === key)) add("load_number_exists");

  // Driver: exact, unique, active.
  const driverName = str(v.driver_name);
  let driverId: string | null = null;
  if (!driverName) add("no_driver_printed");
  else {
    const m = matchDriver(x.ownerId, x.drivers, { person_name: driverName });
    if (!m.target_id || m.evidence.includes("ambiguous") || m.evidence.includes("conflict")) add("driver_not_unique");
    else {
      const d = x.drivers.find((dr) => dr.id === m.target_id);
      if (!d || d.profile_id !== x.ownerId) add("driver_not_unique");
      else if (d.active === false) add("driver_inactive");
      else driverId = d.id;
    }
  }

  // Required fields + dates.
  const broker = str(v.broker_name), origin = str(v.origin), destination = str(v.destination);
  const pu = str(v.pickup_date), del = str(v.delivery_date);
  if (!broker || !origin || !destination || !pu || !del) add("missing_fields");
  if (pu && del && (del < pu || days(pu, del) > 30 || days(x.today, del) > 60 || days(del, x.today) > 365)) add("dates_invalid");

  // Money.
  const total = num(v.total_revenue);
  if (total === null || total <= 0) add("no_revenue");
  const val = validatePayrollExtraction(e, { today: x.today });
  if (val.issues.length > 0) add("validation");

  if (r.length > 0 || !driverId || !loadNumber || !broker || !origin || !destination || !pu || !del || total === null) {
    return { eligible: false, reasons: r.length ? r : ["missing_fields"] };
  }
  return {
    eligible: true,
    driverName: driverName!,
    row: {
      load_number: loadNumber, broker_name: broker, broker_mc_number: str(v.broker_mc_number),
      origin, destination, pickup_date: pu, delivery_date: del,
      total_miles: num(v.total_miles), line_haul_rate: num(v.line_haul_rate), fuel_surcharge: num(v.fuel_surcharge),
      accessorial_charges: num(v.accessorial_charges), total_revenue: total, driver_id: driverId,
    },
  };
}
