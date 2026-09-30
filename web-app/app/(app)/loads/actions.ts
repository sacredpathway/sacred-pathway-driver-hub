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
import { FieldError, UUID_RE, maybeUuid } from "@/lib/loads/formFields";
import { assertLoadColumns } from "@/lib/loads/schema";
import {
  buildCreateLoadPayload,
  buildUpdateLoadPayload,
  type CreateLoadPayload,
  type UpdateLoadPayload,
} from "@/lib/loads/payloads";
import { saveBrokerContact, type BrokerContactInput } from "@/lib/brokers/contact";

// Form parsing helpers live in lib/loads/formFields.ts so payload builders are
// testable outside this "use server" module.
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
    .update(assertLoadColumns({ truck_id: truckId, trailer_id: trailerId }, "updateLoadAssignmentAction"))
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
//  Update FULL load — broker / route / dates / miles / revenue / truck /
//  trailer. Status is never written here (see buildUpdateLoadPayload). Preserves the same ownership re-checks the
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

  // No status on edit (owner decision 2026-09-30): buildUpdateLoadPayload has
  // no `status` key, so the UPDATE never touches loads.status and the load's
  // existing status — including settled / cancelled — is preserved exactly.
  let payload: UpdateLoadPayload;
  let truckId: string | null;
  let trailerId: string | null;

  try {
    payload = buildUpdateLoadPayload(formData);
    truckId = payload.truck_id;
    trailerId = payload.trailer_id;
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
    .update(assertLoadColumns(payload, "updateLoadAction"))
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
  let payload: CreateLoadPayload;
  let brokerContact: BrokerContactInput;
  let driverId:  string | null;
  let truckId:   string | null;
  let trailerId: string | null;

  try {
    // Only real `loads` columns go in `payload`; rep details go to
    // brokers / broker_contacts (see lib/loads/payloads.ts).
    ({ payload, brokerContact } = buildCreateLoadPayload(formData));
    driverId  = payload.driver_id;
    truckId   = payload.truck_id;
    trailerId = payload.trailer_id;
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
    .insert(assertLoadColumns({ ...payload, profile_id: user.id }, "createLoadAction"))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // Broker rep → brokers / broker_contacts (the production model). The load
  // is already saved; a failure here is reported, never hidden, never fatal.
  const brokerResult = await saveBrokerContact(supabase, user.id, brokerContact);

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
  redirect(
    `/loads/${data.id}?created=1` +
      (brokerResult.status === "failed" ? "&broker_contact=failed" : "")
  );
}
