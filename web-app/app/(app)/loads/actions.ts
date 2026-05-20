// =============================================================================
//  Load server actions — Carrier HQ Phase W3 step 3
// -----------------------------------------------------------------------------
//  Scope: assign / unassign a truck and trailer to an existing load.
//
//  Why this is the first load-write action: loads are created by the iOS app
//  today; web carriers just need to backfill the fleet linkage from a desktop.
//  Full create/edit lands in a later step.
//
//  Defenses on every write:
//    auth.getUser() →
//    explicit `.eq("profile_id", user.id)` on the UPDATE (RLS is the backstop) →
//    truck/trailer ownership verified via a tight SELECT before the UPDATE
//      so a malicious client can't FK-link a load to another carrier's
//      fleet unit even if RLS on loads passes.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";
import { LOAD_STATUSES } from "./constants";

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

function num(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; label?: string }
): number | null {
  const raw = s(formData, name);
  if (raw === null) return null;
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

function date(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new FieldError(name, "Date must be YYYY-MM-DD.");
  }
  return raw;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maybeUuid(formData: FormData, name: string, label: string): string | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  if (!UUID_RE.test(raw)) {
    throw new FieldError(name, `${label} is invalid.`);
  }
  return raw.toLowerCase();
}

export type LoadActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// =============================================================================
//  Update truck/trailer assignment
// =============================================================================

export async function updateLoadAssignmentAction(
  loadId: string,
  _prev: LoadActionState | undefined,
  formData: FormData
): Promise<LoadActionState> {
  if (!loadId || !UUID_RE.test(loadId)) {
    return { ok: false, error: "Missing or invalid load id." };
  }

  let truckId: string | null;
  let trailerId: string | null;
  try {
    truckId = maybeUuid(formData, "truck_id", "Truck");
    trailerId = maybeUuid(formData, "trailer_id", "Trailer");
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // ---- Verify the load belongs to the user ------------------------------
  // RLS makes the SELECT return no row for cross-user attempts; we treat
  // that as 404.
  const { data: loadRow, error: loadErr } = await supabase
    .from("loads")
    .select("id")
    .eq("id", loadId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!loadRow) return { ok: false, error: "Load not found." };

  // ---- Verify truck ownership (if assigning) ---------------------------
  if (truckId) {
    const { data: t, error: tErr } = await supabase
      .from("trucks")
      .select("id, status")
      .eq("id", truckId)
      .maybeSingle();
    if (tErr) return { ok: false, error: tErr.message };
    if (!t) {
      return {
        ok: false,
        error: "Selected truck isn't in your fleet.",
        field: "truck_id",
      };
    }
    // Soft warning isn't blocked — `sold` trucks can still receive historical
    // loads. UI should hide them, but the action stays permissive.
  }

  // ---- Verify trailer ownership (if assigning) -------------------------
  if (trailerId) {
    const { data: tr, error: trErr } = await supabase
      .from("trailers")
      .select("id, status")
      .eq("id", trailerId)
      .maybeSingle();
    if (trErr) return { ok: false, error: trErr.message };
    if (!tr) {
      return {
        ok: false,
        error: "Selected trailer isn't in your fleet.",
        field: "trailer_id",
      };
    }
  }

  // ---- Persist ---------------------------------------------------------
  const { error } = await supabase
    .from("loads")
    .update({ truck_id: truckId, trailer_id: trailerId })
    .eq("id", loadId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, user.id, {
    entityType: "load",
    entityId: loadId,
    action: "assigned",
    metadata: { truck_id: truckId, trailer_id: trailerId },
  });

  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  return { ok: true };
}

// =============================================================================
//  Update FULL load — broker / route / dates / miles / revenue / status /
//  notes / truck / trailer. Preserves the same ownership re-checks the
//  assignment-only action uses, and explicitly allows unassign (truck_id /
//  trailer_id → NULL).
// =============================================================================

export async function updateLoadAction(
  loadId: string,
  _prev: LoadActionState | undefined,
  formData: FormData
): Promise<LoadActionState> {
  if (!loadId || !UUID_RE.test(loadId)) {
    return { ok: false, error: "Missing or invalid load id." };
  }

  let payload: {
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
    status: string | null;
    truck_id: string | null;
    trailer_id: string | null;
  };

  let truckId: string | null;
  let trailerId: string | null;

  try {
    const statusRaw = s(formData, "status");
    if (statusRaw && !(LOAD_STATUSES as ReadonlyArray<string>).includes(statusRaw)) {
      throw new FieldError(
        "status",
        `Status must be one of: ${LOAD_STATUSES.join(", ")}.`
      );
    }
    truckId = maybeUuid(formData, "truck_id", "Truck");
    trailerId = maybeUuid(formData, "trailer_id", "Trailer");

    payload = {
      load_number:        s(formData, "load_number"),
      broker_name:        s(formData, "broker_name"),
      broker_mc_number:   s(formData, "broker_mc_number"),
      origin:             s(formData, "origin"),
      destination:        s(formData, "destination"),
      pickup_date:        date(formData, "pickup_date"),
      delivery_date:      date(formData, "delivery_date"),
      total_miles:        num(formData, "total_miles", { nonNegative: true, label: "Miles" }),
      line_haul_rate:     num(formData, "line_haul_rate", { nonNegative: true, label: "Line haul" }),
      fuel_surcharge:     num(formData, "fuel_surcharge", { nonNegative: true, label: "Fuel surcharge" }),
      accessorial_charges: num(formData, "accessorial_charges", { nonNegative: true, label: "Accessorials" }),
      total_revenue:      num(formData, "total_revenue", { nonNegative: true, label: "Total revenue" }),
      status:             statusRaw,
      truck_id:           truckId,
      trailer_id:         trailerId,
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  // Cross-field rule: if pickup AND delivery both set, delivery must be on/after pickup.
  if (payload.pickup_date && payload.delivery_date &&
      new Date(payload.delivery_date) < new Date(payload.pickup_date)) {
    return {
      ok: false,
      error: "Delivery date must be on or after pickup date.",
      field: "delivery_date",
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // ---- Verify the load belongs to the user (RLS-backed) ----------------
  const { data: loadRow, error: loadErr } = await supabase
    .from("loads")
    .select("id")
    .eq("id", loadId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!loadRow) return { ok: false, error: "Load not found." };

  // ---- Re-verify truck / trailer ownership when assigning -------------
  if (truckId) {
    const { data: t } = await supabase
      .from("trucks").select("id").eq("id", truckId).maybeSingle();
    if (!t) return { ok: false, error: "Selected truck isn't in your fleet.", field: "truck_id" };
  }
  if (trailerId) {
    const { data: tr } = await supabase
      .from("trailers").select("id").eq("id", trailerId).maybeSingle();
    if (!tr) return { ok: false, error: "Selected trailer isn't in your fleet.", field: "trailer_id" };
  }

  // ---- Persist ---------------------------------------------------------
  const { error } = await supabase
    .from("loads")
    .update(payload)
    .eq("id", loadId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, user.id, {
    entityType: "load",
    entityId: loadId,
    action: "updated",
    metadata: {
      label: `Load ${payload.load_number ? `#${payload.load_number}` : loadId.slice(0, 8)} updated${payload.broker_name ? ` (${payload.broker_name})` : ""}`,
      amount: payload.total_revenue,
      status: payload.status,
    },
  });

  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  revalidatePath(`/loads/${loadId}/edit`);
  redirect(`/loads/${loadId}?updated=1`);
}

// =============================================================================
//  Safely delete a load (Phase E5)
// -----------------------------------------------------------------------------
//  Rules:
//    • Refuse if the load is referenced by any paystub_earnings.load_id or
//      paystub_settlement_items.load_id whose parent paystub is in a locked
//      status (issued | paid | voided). Those rows are immutable history.
//    • If only referenced by DRAFT paystubs, also refuse — the carrier should
//      remove the row from the draft first (transparency over silent breakage).
//    • Otherwise hard delete is allowed.
//
//  We do NOT mark loads inactive — the iOS app + accounting workflows expect
//  loads to either exist or not. Truncating to a soft-delete column here
//  would be schema drift versus iOS.
// =============================================================================

export async function deleteLoadAction(loadId: string): Promise<void> {
  if (!loadId || !UUID_RE.test(loadId)) throw new Error("Missing or invalid load id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // Ownership + existence (RLS will silently filter cross-user attempts)
  const { data: loadRow } = await supabase
    .from("loads").select("id").eq("id", loadId).maybeSingle();
  if (!loadRow) throw new Error("Load not found.");

  // Reference check — paystub_earnings
  const { data: earningRefs, error: eErr } = await supabase
    .from("paystub_earnings")
    .select("paystub_id, paystubs!inner(status)")
    .eq("load_id", loadId);
  if (eErr) throw new Error(eErr.message);

  // Reference check — paystub_settlement_items
  const { data: settlementRefs, error: sErr } = await supabase
    .from("paystub_settlement_items")
    .select("paystub_id, paystubs!inner(status)")
    .eq("load_id", loadId);
  if (sErr) throw new Error(sErr.message);

  // Type-safe inspection of the joined paystub status field
  type StatusRef = { paystub_id: string; paystubs: { status: string } | { status: string }[] };
  const allRefs: StatusRef[] = [
    ...((earningRefs ?? []) as StatusRef[]),
    ...((settlementRefs ?? []) as StatusRef[]),
  ];

  function statusOf(r: StatusRef): string | null {
    const p = r.paystubs;
    if (Array.isArray(p)) return p[0]?.status ?? null;
    return p?.status ?? null;
  }

  const lockedRefs = allRefs.filter((r) => {
    const s = statusOf(r);
    return s === "issued" || s === "paid" || s === "voided";
  });
  if (lockedRefs.length > 0) {
    throw new Error(
      "This load is on " + lockedRefs.length +
      " issued, paid, or voided paystub line item(s). " +
      "Locked paystubs preserve their history — the load can't be deleted."
    );
  }

  const draftRefs = allRefs.filter((r) => statusOf(r) === "draft");
  if (draftRefs.length > 0) {
    throw new Error(
      "This load is attached to " + draftRefs.length +
      " draft paystub line item(s). Remove it from the draft(s) first, " +
      "then try deleting the load again."
    );
  }

  // Safe to delete.
  const { error } = await supabase
    .from("loads").delete().eq("id", loadId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "load",
    entityId: loadId,
    action: "deleted",
    metadata: {
      label: `Load ${(loadRow as { id: string }).id.slice(0, 8)} deleted`,
    },
  });

  revalidatePath("/loads");
  redirect("/loads?deleted=1");
}

// =============================================================================
//  CREATE load — Phase W7
// -----------------------------------------------------------------------------
//  Shape matches the iOS Smart Scan output so a manually-typed load is
//  indistinguishable downstream from a scanned one. Optional driver / truck /
//  trailer pickers are gated by ownership re-checks (same as updateLoadAction).
//
//  Broker linkage strategy: iOS owns the brokers/broker_contacts normalization
//  pipeline. For the web create flow we accept free-form broker_name (+ MC #,
//  contact info) and leave broker_id / broker_contact_id NULL. iOS Smart Scan
//  Review and the brokers list continue to back-fill those via their own
//  matchers, so the load eventually picks up the linkage with no web-side
//  duplication of the matcher.
// =============================================================================

export async function createLoadAction(
  _prev: LoadActionState | undefined,
  formData: FormData
): Promise<LoadActionState> {
  let payload: {
    load_number: string | null;
    broker_name: string | null;
    broker_mc_number: string | null;
    broker_contact_name: string | null;
    broker_contact_phone: string | null;
    broker_phone_extension: string | null;
    broker_contact_email: string | null;
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
  };

  let driverId:  string | null;
  let truckId:   string | null;
  let trailerId: string | null;

  try {
    const statusRaw = s(formData, "status") ?? "unassigned";
    if (!(LOAD_STATUSES as ReadonlyArray<string>).includes(statusRaw)) {
      throw new FieldError(
        "status",
        `Status must be one of: ${LOAD_STATUSES.join(", ")}.`
      );
    }

    driverId  = maybeUuid(formData, "driver_id",  "Driver");
    truckId   = maybeUuid(formData, "truck_id",   "Truck");
    trailerId = maybeUuid(formData, "trailer_id", "Trailer");

    payload = {
      load_number:            s(formData, "load_number"),
      broker_name:            s(formData, "broker_name"),
      broker_mc_number:       s(formData, "broker_mc_number"),
      broker_contact_name:    s(formData, "broker_contact_name"),
      broker_contact_phone:   s(formData, "broker_contact_phone"),
      broker_phone_extension: s(formData, "broker_phone_extension"),
      broker_contact_email:   s(formData, "broker_contact_email"),
      origin:                 s(formData, "origin"),
      destination:            s(formData, "destination"),
      pickup_date:            date(formData, "pickup_date"),
      delivery_date:          date(formData, "delivery_date"),
      total_miles:            num(formData, "total_miles",        { nonNegative: true, label: "Miles" }),
      line_haul_rate:         num(formData, "line_haul_rate",     { nonNegative: true, label: "Line haul" }),
      fuel_surcharge:         num(formData, "fuel_surcharge",     { nonNegative: true, label: "Fuel surcharge" }),
      accessorial_charges:    num(formData, "accessorial_charges",{ nonNegative: true, label: "Accessorials" }),
      total_revenue:          num(formData, "total_revenue",      { nonNegative: true, label: "Total revenue" }),
      status:                 statusRaw,
      driver_id:              driverId,
      truck_id:               truckId,
      trailer_id:             trailerId,
    };

    // Auto-compute total_revenue if the carrier filled the components but
    // left total blank. Mirrors iOS scan behavior.
    if (payload.total_revenue === null) {
      const parts =
        (payload.line_haul_rate     ?? 0) +
        (payload.fuel_surcharge     ?? 0) +
        (payload.accessorial_charges ?? 0);
      if (parts > 0) payload.total_revenue = Math.round(parts * 100) / 100;
    }
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  // At least one of: load_number, broker_name, origin, destination must be
  // provided so the row is identifiable in lists.
  if (
    !payload.load_number &&
    !payload.broker_name &&
    !payload.origin &&
    !payload.destination
  ) {
    return {
      ok: false,
      error: "Provide at least a load #, broker, origin, or destination.",
      field: "load_number",
    };
  }

  if (
    payload.pickup_date && payload.delivery_date &&
    new Date(payload.delivery_date) < new Date(payload.pickup_date)
  ) {
    return {
      ok: false,
      error: "Delivery date must be on or after pickup date.",
      field: "delivery_date",
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership re-checks for the optional FKs.
  if (driverId) {
    const { data } = await supabase.from("drivers").select("id").eq("id", driverId).maybeSingle();
    if (!data) return { ok: false, error: "Selected driver isn't on your roster.", field: "driver_id" };
  }
  if (truckId) {
    const { data } = await supabase.from("trucks").select("id").eq("id", truckId).maybeSingle();
    if (!data) return { ok: false, error: "Selected truck isn't in your fleet.", field: "truck_id" };
  }
  if (trailerId) {
    const { data } = await supabase.from("trailers").select("id").eq("id", trailerId).maybeSingle();
    if (!data) return { ok: false, error: "Selected trailer isn't in your fleet.", field: "trailer_id" };
  }

  const { data, error } = await supabase
    .from("loads")
    .insert({ ...payload, profile_id: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, user.id, {
    entityType: "load",
    entityId: data.id,
    action: "created",
    metadata: {
      label: `Load ${payload.load_number ? `#${payload.load_number}` : data.id.slice(0, 8)} created${payload.broker_name ? ` for ${payload.broker_name}` : ""}`,
      amount: payload.total_revenue,
    },
  });

  revalidatePath("/loads");
  revalidatePath("/dashboard");
  redirect(`/loads/${data.id}?created=1`);
}
