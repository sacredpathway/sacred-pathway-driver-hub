// =============================================================================
//  Driver server actions — Carrier HQ Phase W2 commit #2
// -----------------------------------------------------------------------------
//  All write paths for the /drivers UI. Server-side validation here is the
//  source of truth — never trust the form. Supabase RLS (profile_id =
//  auth.uid()) is the second gate; together they guarantee a user can only
//  read/write their own drivers.
//
//  No paystub generation here — that lands in commit #3. These actions only
//  cover driver create / update / soft-delete / active toggle.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import type {
  WorkerType,
  EmploymentStatus,
  PayFrequency,
  CompType,
  FilingStatus,
} from "@/lib/supabase/types";

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

const WORKER_TYPES: ReadonlyArray<WorkerType> = ["1099", "W2"];
const EMPLOYMENT_STATUSES: ReadonlyArray<EmploymentStatus> = [
  "active",
  "on_leave",
  "terminated",
];
const PAY_FREQUENCIES: ReadonlyArray<PayFrequency> = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
];
const COMP_TYPES: ReadonlyArray<CompType> = ["hourly", "salary", "mileage", "per_load"];
const FILING_STATUSES: ReadonlyArray<FilingStatus> = [
  "single",
  "married",
  "married_separate",
  "head_of_household",
];

class FieldError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function requireStr(formData: FormData, name: string, label: string): string {
  const v = s(formData, name);
  if (v === null) throw new FieldError(name, `${label} is required.`);
  return v;
}

function num(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; label?: string }
): number | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  // Allow user-friendly inputs: "$25.00", "1,500", "25%"
  const cleaned = raw.replace(/[$,%\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new FieldError(name, `${opts?.label ?? name} must be a number.`);
  }
  if (opts?.nonNegative && n < 0) {
    throw new FieldError(name, `${opts?.label ?? name} cannot be negative.`);
  }
  return n;
}

function int(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; label?: string }
): number | null {
  const v = num(formData, name, opts);
  if (v === null) return null;
  if (!Number.isInteger(v)) {
    throw new FieldError(name, `${opts?.label ?? name} must be a whole number.`);
  }
  return v;
}

function date(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new FieldError(name, "Date must be YYYY-MM-DD.");
  }
  return raw;
}

function bool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
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

function workerType(formData: FormData): WorkerType {
  const raw = s(formData, "worker_type");
  if (!raw || !(WORKER_TYPES as ReadonlyArray<string>).includes(raw)) {
    throw new FieldError("worker_type", "Worker type must be '1099' or 'W2'.");
  }
  return raw as WorkerType;
}

// -----------------------------------------------------------------------------
// Build the driver row from the form
// -----------------------------------------------------------------------------

interface DriverWritePayload {
  name: string;
  worker_type: WorkerType;
  truck_number: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;

  // Common — 1099 + carryover
  pay_type: string | null;
  pay_percentage: number | null;
  flat_rate: number | null;

  // 1099 escrow
  escrow_per_settlement: number | null;
  escrow_balance: number | null;

  // W2 compensation
  employment_status: EmploymentStatus | null;
  pay_frequency: PayFrequency | null;
  comp_type: CompType | null;
  hourly_rate: number | null;
  salary_annual: number | null;
  mileage_rate: number | null;
  per_load_rate: number | null;
  per_diem_daily: number | null;
  overtime_multiplier: number | null;

  // Tax setup placeholders
  filing_status: FilingStatus | null;
  federal_allowances: number | null;
  w4_extra_withholding: number | null;
  state_code: string | null;
  state_allowances: number | null;
  ein: string | null;

  // HR
  hire_date: string | null;
  termination_date: string | null;
  dob: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_expiration: string | null;
}

function buildPayloadFromForm(formData: FormData): DriverWritePayload {
  const wt = workerType(formData);

  const payload: DriverWritePayload = {
    name: requireStr(formData, "name", "Driver name"),
    worker_type: wt,
    truck_number: s(formData, "truck_number"),
    phone: s(formData, "phone"),
    email: s(formData, "email"),
    active: bool(formData, "active"),

    // 1099 / legacy compensation
    pay_type: s(formData, "pay_type"),
    pay_percentage: num(formData, "pay_percentage", {
      nonNegative: true,
      label: "Pay percentage",
    }),
    flat_rate: num(formData, "flat_rate", {
      nonNegative: true,
      label: "Flat rate",
    }),
    escrow_per_settlement: num(formData, "escrow_per_settlement", {
      nonNegative: true,
      label: "Escrow per settlement",
    }),
    escrow_balance: num(formData, "escrow_balance", {
      nonNegative: true,
      label: "Escrow balance",
    }),

    // W2 compensation
    employment_status: enumOrNull(
      formData,
      "employment_status",
      EMPLOYMENT_STATUSES,
      "Employment status"
    ),
    pay_frequency: enumOrNull(formData, "pay_frequency", PAY_FREQUENCIES, "Pay frequency"),
    comp_type: enumOrNull(formData, "comp_type", COMP_TYPES, "Compensation type"),
    hourly_rate: num(formData, "hourly_rate", {
      nonNegative: true,
      label: "Hourly rate",
    }),
    salary_annual: num(formData, "salary_annual", {
      nonNegative: true,
      label: "Annual salary",
    }),
    mileage_rate: num(formData, "mileage_rate", {
      nonNegative: true,
      label: "Mileage rate",
    }),
    per_load_rate: num(formData, "per_load_rate", {
      nonNegative: true,
      label: "Per-load rate",
    }),
    per_diem_daily: num(formData, "per_diem_daily", {
      nonNegative: true,
      label: "Per diem",
    }),
    overtime_multiplier: num(formData, "overtime_multiplier", {
      nonNegative: true,
      label: "Overtime multiplier",
    }),

    // Tax placeholders
    filing_status: enumOrNull(formData, "filing_status", FILING_STATUSES, "Filing status"),
    federal_allowances: int(formData, "federal_allowances", {
      nonNegative: true,
      label: "Federal allowances",
    }),
    w4_extra_withholding: num(formData, "w4_extra_withholding", {
      nonNegative: true,
      label: "W-4 extra withholding",
    }),
    state_code: s(formData, "state_code"),
    state_allowances: int(formData, "state_allowances", {
      nonNegative: true,
      label: "State allowances",
    }),
    ein: s(formData, "ein"),

    // HR
    hire_date: date(formData, "hire_date"),
    termination_date: date(formData, "termination_date"),
    dob: date(formData, "dob"),
    address: s(formData, "address"),
    city: s(formData, "city"),
    state: s(formData, "state"),
    zip: s(formData, "zip"),
    emergency_contact_name: s(formData, "emergency_contact_name"),
    emergency_contact_phone: s(formData, "emergency_contact_phone"),
    cdl_number: s(formData, "cdl_number"),
    cdl_state: s(formData, "cdl_state"),
    cdl_expiration: date(formData, "cdl_expiration"),
  };

  // Cross-field rule: 1099 drivers without an explicit pay_type fall back to
  // "percent" so the legacy iOS calc continues to work.
  if (payload.worker_type === "1099" && payload.pay_type === null) {
    payload.pay_type = "percent";
  }

  // Cross-field rule: W2 drivers don't use 1099 compensation columns. Null
  // them so future settlement engine reads can branch cleanly on worker_type
  // and so the printed paystub never mixes 1099 % with W2 hourly wages.
  if (payload.worker_type === "W2") {
    payload.pay_type = null;
    payload.pay_percentage = null;
    payload.flat_rate = null;
    payload.escrow_per_settlement = null;
    // escrow_balance preserved — could be a historic 1099 carryover; UI hides
    // it for W2 but keeps the value so a later reclassify back to 1099 still
    // shows the running balance.
  }

  // Cross-field rule: 1099 drivers don't use W2 compensation / tax setup
  // columns. Null them to keep the printed contractor settlement clean.
  if (payload.worker_type === "1099") {
    payload.employment_status = null;
    payload.pay_frequency = null;
    payload.comp_type = null;
    payload.hourly_rate = null;
    payload.salary_annual = null;
    payload.mileage_rate = null;
    payload.per_load_rate = null;
    payload.per_diem_daily = null;
    payload.overtime_multiplier = null;
    payload.filing_status = null;
    payload.federal_allowances = null;
    payload.w4_extra_withholding = null;
    payload.state_code = null;
    payload.state_allowances = null;
    // ein preserved — 1099 contractors who invoice via an LLC still need it
    // on the year-end 1099-NEC export.
  }

  return payload;
}

// -----------------------------------------------------------------------------
// Action results — let the client render errors inline
// -----------------------------------------------------------------------------

export type DriverActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// -----------------------------------------------------------------------------
// CREATE
// -----------------------------------------------------------------------------

export async function createDriverAction(
  _prev: DriverActionState | undefined,
  formData: FormData
): Promise<DriverActionState> {
  let payload: DriverWritePayload;
  try {
    payload = buildPayloadFromForm(formData);
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      ...payload,
      profile_id: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, user.id, {
    entityType: "driver",
    entityId: data.id,
    action: "created",
    metadata: {
      label: `Driver ${payload.name} added (${payload.worker_type})`,
      driver: payload.name,
      worker_type: payload.worker_type,
    },
  });

  revalidatePath("/drivers");
  redirect(`/drivers/${data.id}?created=1`);
}

// -----------------------------------------------------------------------------
// UPDATE
// -----------------------------------------------------------------------------

export async function updateDriverAction(
  driverId: string,
  _prev: DriverActionState | undefined,
  formData: FormData
): Promise<DriverActionState> {
  if (!driverId) return { ok: false, error: "Missing driver id." };

  let payload: DriverWritePayload;
  try {
    payload = buildPayloadFromForm(formData);
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("drivers")
    .update(payload)
    .eq("id", driverId)
    .eq("profile_id", user.id); // belt + RLS suspenders

  if (error) {
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, user.id, {
    entityType: "driver",
    entityId: driverId,
    action: "updated",
    metadata: {
      label: `Driver ${payload.name} updated`,
      driver: payload.name,
      worker_type: payload.worker_type,
    },
  });

  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
  redirect(`/drivers/${driverId}?updated=1`);
}

// -----------------------------------------------------------------------------
// SOFT-DELETE (deactivate) — never hard-delete a driver because paystubs FK
// uses ON DELETE RESTRICT to preserve payroll history integrity.
// -----------------------------------------------------------------------------

// Note: these two return Promise<void> rather than DriverActionState because
// they're wired directly to <form action={…}> in the edit page (no useActionState).
// Errors are thrown so Next.js can surface them via the route's error boundary.

export async function deactivateDriverAction(driverId: string): Promise<void> {
  if (!driverId) throw new Error("Missing driver id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("drivers")
    .update({ active: false, employment_status: "terminated" })
    .eq("id", driverId)
    .eq("profile_id", user.id);

  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "driver",
    entityId: driverId,
    action: "deactivated",
  });

  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
}

export async function reactivateDriverAction(driverId: string): Promise<void> {
  if (!driverId) throw new Error("Missing driver id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("drivers")
    .update({ active: true, employment_status: "active" })
    .eq("id", driverId)
    .eq("profile_id", user.id);

  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "driver",
    entityId: driverId,
    action: "reactivated",
  });

  revalidatePath("/drivers");
  revalidatePath(`/drivers/${driverId}`);
}
