// =============================================================================
//  Expense server actions — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Create / update / delete for /expenses. Same defense pattern as drivers,
//  loads, and settings actions:
//    auth.getUser() →
//    server-side validation (no client-trust) →
//    UPDATE/DELETE with explicit .eq("profile_id", user.id) (RLS is backstop).
//
//  iOS continues to write to the same `expenses` table; this server action set
//  is purely additive (no schema change). Categories below mirror the iOS
//  picker so the two clients stay visually consistent.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

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

function num(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; label?: string; required?: boolean }
): number | null {
  const raw = s(formData, name);
  if (raw === null) {
    if (opts?.required) {
      throw new FieldError(name, `${opts?.label ?? name} is required.`);
    }
    return null;
  }
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

// Mirrors iOS AddEditExpenseView's hard-coded picker so the two clients
// agree on the canonical set. "other" is the catch-all.
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

export type ExpenseActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

interface ExpenseWritePayload {
  category: string;
  amount: number;
  vendor_name: string | null;
  description: string | null;
  receipt_date: string | null;
  load_id: string | null;
  gallons: number | null;
  price_per_gallon: number | null;
  def_gallons: number | null;
  def_price_per_gallon: number | null;
  def_total: number | null;
}

function buildPayloadFromForm(formData: FormData): ExpenseWritePayload {
  const category = requireStr(formData, "category", "Category").toLowerCase();
  if (!EXPENSE_CATEGORIES.includes(category)) {
    throw new FieldError(
      "category",
      `Category must be one of: ${EXPENSE_CATEGORIES.join(", ")}.`
    );
  }

  const amount = num(formData, "amount", {
    nonNegative: true,
    required: true,
    label: "Amount",
  })!;

  // Fuel-specific fields — only stored when the category is fuel (defensive
  // so we don't accidentally persist gallons on a toll expense).
  const isFuel = category === "fuel";
  const gallons          = isFuel ? num(formData, "gallons",          { nonNegative: true, label: "Gallons" })          : null;
  const pricePerGallon   = isFuel ? num(formData, "price_per_gallon", { nonNegative: true, label: "Price / gal" })       : null;
  const defGallons       = isFuel ? num(formData, "def_gallons",      { nonNegative: true, label: "DEF gallons" })       : null;
  const defPricePerGallon= isFuel ? num(formData, "def_price_per_gallon", { nonNegative: true, label: "DEF price / gal" }): null;

  // Server-compute def_total — keeps reports honest if the user types one
  // half of the pair but not the other.
  let defTotal: number | null = null;
  if (isFuel && defGallons !== null && defPricePerGallon !== null) {
    defTotal = Math.round(defGallons * defPricePerGallon * 100) / 100;
  }

  return {
    category,
    amount,
    vendor_name: s(formData, "vendor_name"),
    description: s(formData, "description"),
    receipt_date: date(formData, "receipt_date"),
    load_id: maybeUuid(formData, "load_id", "Load"),
    gallons,
    price_per_gallon: pricePerGallon,
    def_gallons: defGallons,
    def_price_per_gallon: defPricePerGallon,
    def_total: defTotal,
  };
}

// =============================================================================
//  CREATE
// =============================================================================

export async function createExpenseAction(
  _prev: ExpenseActionState | undefined,
  formData: FormData
): Promise<ExpenseActionState> {
  let payload: ExpenseWritePayload;
  try {
    payload = buildPayloadFromForm(formData);
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Re-verify load ownership when one is attached — same shape as loads.actions
  if (payload.load_id) {
    const { data: load, error: lErr } = await supabase
      .from("loads")
      .select("id")
      .eq("id", payload.load_id)
      .maybeSingle();
    if (lErr) return { ok: false, error: lErr.message };
    if (!load) return {
      ok: false,
      error: "Selected load isn't in your account.",
      field: "load_id",
    };
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...payload, profile_id: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, user.id, {
    entityType: "expense",
    entityId: data.id,
    action: "created",
    metadata: {
      label: `${payload.category[0].toUpperCase()}${payload.category.slice(1)} expense logged${payload.vendor_name ? ` · ${payload.vendor_name}` : ""}`,
      amount: payload.amount,
      category: payload.category,
    },
  });

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  redirect(`/expenses/${data.id}?created=1`);
}

// =============================================================================
//  UPDATE
// =============================================================================

export async function updateExpenseAction(
  expenseId: string,
  _prev: ExpenseActionState | undefined,
  formData: FormData
): Promise<ExpenseActionState> {
  if (!expenseId || !UUID_RE.test(expenseId)) {
    return { ok: false, error: "Missing or invalid expense id." };
  }

  let payload: ExpenseWritePayload;
  try {
    payload = buildPayloadFromForm(formData);
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership existence check (RLS will silently filter cross-user)
  const { data: row } = await supabase
    .from("expenses")
    .select("id")
    .eq("id", expenseId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Expense not found." };

  if (payload.load_id) {
    const { data: load } = await supabase
      .from("loads")
      .select("id")
      .eq("id", payload.load_id)
      .maybeSingle();
    if (!load) return {
      ok: false,
      error: "Selected load isn't in your account.",
      field: "load_id",
    };
  }

  const { error } = await supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, user.id, {
    entityType: "expense",
    entityId: expenseId,
    action: "updated",
    metadata: {
      label: `Expense updated · ${payload.category}${payload.vendor_name ? ` · ${payload.vendor_name}` : ""}`,
      amount: payload.amount,
      category: payload.category,
    },
  });

  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/dashboard");
  redirect(`/expenses/${expenseId}?updated=1`);
}

// =============================================================================
//  DELETE
// -----------------------------------------------------------------------------
//  Form-action variant (no useActionState). Wired straight to a <form>. Hard
//  delete — expenses are pure financial line items, no FK fanout to worry
//  about. Returns void; throws on failure for the route error boundary.
// =============================================================================

export async function deleteExpenseAction(expenseId: string): Promise<void> {
  if (!expenseId || !UUID_RE.test(expenseId)) throw new Error("Missing or invalid expense id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: row } = await supabase
    .from("expenses").select("id").eq("id", expenseId).maybeSingle();
  if (!row) throw new Error("Expense not found.");

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "expense",
    entityId: expenseId,
    action: "deleted",
  });

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  redirect("/expenses?deleted=1");
}
