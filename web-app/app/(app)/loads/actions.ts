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

  revalidatePath("/loads");
  revalidatePath(`/loads/${loadId}`);
  return { ok: true };
}
