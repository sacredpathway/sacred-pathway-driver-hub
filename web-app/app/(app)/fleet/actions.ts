// =============================================================================
//  Fleet server actions — Carrier HQ Phase W3 step 2
// -----------------------------------------------------------------------------
//  Create-only for now. List reads happen directly in the server components.
//  Edit/delete/link-to-loads land in later steps.
//
//  Hard gates on every write:
//    auth.getUser() → profile_id forced to user.id → RLS catches anything that
//    slips → enum / non-negative / range validation thrown back as FieldError.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { FleetStatus, TrailerType } from "@/lib/supabase/types";

// -----------------------------------------------------------------------------
// Validation helpers (mirror the payroll/drivers actions so the API is
// consistent across the app)
// -----------------------------------------------------------------------------

const FLEET_STATUSES: ReadonlyArray<FleetStatus> = [
  "active", "inactive", "maintenance", "sold",
];

const TRAILER_TYPES: ReadonlyArray<TrailerType> = [
  "dry_van", "reefer", "flatbed", "step_deck", "tanker",
  "lowboy", "car_hauler", "container", "dump", "hopper", "other",
];

class FieldError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

function requireStr(formData: FormData, name: string, label: string): string {
  const v = s(formData, name);
  if (v === null) throw new FieldError(name, `${label} is required.`);
  return v;
}

function intInRange(
  formData: FormData,
  name: string,
  min: number,
  max: number,
  label: string
): number | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new FieldError(name, `${label} must be a whole number.`);
  }
  if (n < min || n > max) {
    throw new FieldError(name, `${label} must be between ${min} and ${max}.`);
  }
  return n;
}

function enumOrNull<T extends string>(
  formData: FormData,
  name: string,
  allowed: ReadonlyArray<T>,
  label: string
): T | null {
  const raw = s(formData, name);
  if (!raw) return null;
  if (!(allowed as ReadonlyArray<string>).includes(raw)) {
    throw new FieldError(name, `${label} must be one of: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

function stateCode(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (!raw) return null;
  if (raw.length > 3) {
    throw new FieldError(name, "State must be a 2-letter code (e.g. TX).");
  }
  return raw.toUpperCase();
}

// -----------------------------------------------------------------------------
// Action result shape (matches the rest of Carrier HQ)
// -----------------------------------------------------------------------------

export type FleetActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// =============================================================================
//  CREATE TRUCK
// =============================================================================

export async function createTruckAction(
  _prev: FleetActionState | undefined,
  formData: FormData
): Promise<FleetActionState> {
  let payload: {
    unit_number: string;
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    plate_number: string | null;
    state: string | null;
    status: FleetStatus;
    notes: string | null;
  };

  try {
    const status = enumOrNull(formData, "status", FLEET_STATUSES, "Status");
    payload = {
      unit_number: requireStr(formData, "unit_number", "Unit #"),
      make: s(formData, "make"),
      model: s(formData, "model"),
      year: intInRange(formData, "year", 1900, 2100, "Year"),
      vin: s(formData, "vin"),
      plate_number: s(formData, "plate_number"),
      state: stateCode(formData, "state"),
      status: status ?? "active",
      notes: s(formData, "notes"),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("trucks")
    .insert({ ...payload, profile_id: user.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet");
  redirect("/fleet?added=truck");
}

// =============================================================================
//  CREATE TRAILER
// =============================================================================

export async function createTrailerAction(
  _prev: FleetActionState | undefined,
  formData: FormData
): Promise<FleetActionState> {
  let payload: {
    unit_number: string;
    trailer_type: TrailerType | null;
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    plate_number: string | null;
    state: string | null;
    status: FleetStatus;
    notes: string | null;
  };

  try {
    const status = enumOrNull(formData, "status", FLEET_STATUSES, "Status");
    payload = {
      unit_number: requireStr(formData, "unit_number", "Unit #"),
      trailer_type: enumOrNull(formData, "trailer_type", TRAILER_TYPES, "Trailer type"),
      make: s(formData, "make"),
      model: s(formData, "model"),
      year: intInRange(formData, "year", 1900, 2100, "Year"),
      vin: s(formData, "vin"),
      plate_number: s(formData, "plate_number"),
      state: stateCode(formData, "state"),
      status: status ?? "active",
      notes: s(formData, "notes"),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("trailers")
    .insert({ ...payload, profile_id: user.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet");
  redirect("/fleet?added=trailer");
}

// =============================================================================
//  UPDATE TRUCK
// -----------------------------------------------------------------------------
//  Edits an existing truck. Validation identical to createTruckAction. RLS +
//  explicit profile_id guard on the UPDATE prevents cross-user writes even if
//  a malicious client tampers with the id.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateTruckAction(
  truckId: string,
  _prev: FleetActionState | undefined,
  formData: FormData
): Promise<FleetActionState> {
  if (!truckId || !UUID_RE.test(truckId)) {
    return { ok: false, error: "Missing or invalid truck id." };
  }

  let payload: {
    unit_number: string;
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    plate_number: string | null;
    state: string | null;
    status: FleetStatus;
    notes: string | null;
  };

  try {
    const status = enumOrNull(formData, "status", FLEET_STATUSES, "Status");
    payload = {
      unit_number: requireStr(formData, "unit_number", "Unit #"),
      make: s(formData, "make"),
      model: s(formData, "model"),
      year: intInRange(formData, "year", 1900, 2100, "Year"),
      vin: s(formData, "vin"),
      plate_number: s(formData, "plate_number"),
      state: stateCode(formData, "state"),
      status: status ?? "active",
      notes: s(formData, "notes"),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("trucks")
    .update(payload)
    .eq("id", truckId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet");
  revalidatePath(`/fleet/trucks/${truckId}/edit`);
  redirect(`/fleet?updated=truck`);
}

// =============================================================================
//  UPDATE TRAILER
// =============================================================================

export async function updateTrailerAction(
  trailerId: string,
  _prev: FleetActionState | undefined,
  formData: FormData
): Promise<FleetActionState> {
  if (!trailerId || !UUID_RE.test(trailerId)) {
    return { ok: false, error: "Missing or invalid trailer id." };
  }

  let payload: {
    unit_number: string;
    trailer_type: TrailerType | null;
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    plate_number: string | null;
    state: string | null;
    status: FleetStatus;
    notes: string | null;
  };

  try {
    const status = enumOrNull(formData, "status", FLEET_STATUSES, "Status");
    payload = {
      unit_number: requireStr(formData, "unit_number", "Unit #"),
      trailer_type: enumOrNull(formData, "trailer_type", TRAILER_TYPES, "Trailer type"),
      make: s(formData, "make"),
      model: s(formData, "model"),
      year: intInRange(formData, "year", 1900, 2100, "Year"),
      vin: s(formData, "vin"),
      plate_number: s(formData, "plate_number"),
      state: stateCode(formData, "state"),
      status: status ?? "active",
      notes: s(formData, "notes"),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("trailers")
    .update(payload)
    .eq("id", trailerId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/fleet");
  revalidatePath(`/fleet/trailers/${trailerId}/edit`);
  redirect(`/fleet?updated=trailer`);
}

// =============================================================================
//  Safe delete — Truck / Trailer (Phase E5)
// -----------------------------------------------------------------------------
//  Two paths supported:
//
//    1. Archive (preferred): the existing edit form's Status dropdown can be
//       set to "Sold" or "Inactive". That keeps the row + all historical
//       load attribution intact. Loads.truck_id / trailer_id continue to
//       reference the archived unit.
//
//    2. Hard delete (this action): ONLY allowed when NO load references the
//       unit's id. Loads created by iOS or the web that have ever been
//       assigned to this unit block the delete with a clear error.
//
//  Even if a delete bypassed this check, the FK is ON DELETE SET NULL — loads
//  would survive — but the carrier almost always wants the historical
//  attribution intact, so we refuse here.
// =============================================================================

export async function deleteTruckAction(truckId: string): Promise<void> {
  if (!truckId || !UUID_RE.test(truckId)) throw new Error("Missing or invalid truck id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: truckRow } = await supabase
    .from("trucks").select("id, unit_number").eq("id", truckId).maybeSingle();
  if (!truckRow) throw new Error("Truck not found.");

  // Reference check — any load.truck_id pointing at this truck?
  const { data: refs, error: rErr } = await supabase
    .from("loads")
    .select("id", { count: "exact", head: false })
    .eq("truck_id", truckId)
    .limit(1);
  if (rErr) throw new Error(rErr.message);
  if (refs && refs.length > 0) {
    throw new Error(
      "This truck is referenced by historical loads. " +
      "Archive it by setting Status to 'Sold' or 'Inactive' instead of deleting."
    );
  }

  const { error } = await supabase
    .from("trucks").delete().eq("id", truckId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/fleet");
  redirect("/fleet?deleted=truck");
}

export async function deleteTrailerAction(trailerId: string): Promise<void> {
  if (!trailerId || !UUID_RE.test(trailerId)) throw new Error("Missing or invalid trailer id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: trailerRow } = await supabase
    .from("trailers").select("id, unit_number").eq("id", trailerId).maybeSingle();
  if (!trailerRow) throw new Error("Trailer not found.");

  const { data: refs, error: rErr } = await supabase
    .from("loads")
    .select("id", { count: "exact", head: false })
    .eq("trailer_id", trailerId)
    .limit(1);
  if (rErr) throw new Error(rErr.message);
  if (refs && refs.length > 0) {
    throw new Error(
      "This trailer is referenced by historical loads. " +
      "Archive it by setting Status to 'Sold' or 'Inactive' instead of deleting."
    );
  }

  const { error } = await supabase
    .from("trailers").delete().eq("id", trailerId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/fleet");
  redirect("/fleet?deleted=trailer");
}
