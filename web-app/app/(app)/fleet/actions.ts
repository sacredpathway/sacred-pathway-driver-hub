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
