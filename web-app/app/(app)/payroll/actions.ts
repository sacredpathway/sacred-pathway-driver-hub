// =============================================================================
//  Payroll server actions — Carrier HQ Phase W2 commit #3
// -----------------------------------------------------------------------------
//  All write paths for paystubs and their child line items. Authoritative
//  validation lives here; UI is just a thin form. Supabase RLS
//  (profile_id = auth.uid()) is the second gate.
//
//  Lifecycle:
//    draft   — created; lines can be added/removed/edited
//    issued  — locked (UI hides edit controls); YTD snapshotted, paystub_number
//              assigned, gets a check_date
//    paid    — informational; carrier marks after sending the money
//    voided  — reversed; rolls escrow_balance back if applicable
//
//  YTD snapshot strategy:
//    On issue, we compute YTD totals for the driver up to (and including) this
//    paystub by summing other issued paystubs in the same calendar year plus
//    this one's totals. Snapshots are persisted on the paystub row and on each
//    child row's ytd_amount column so the printed paystub is FROZEN. Future
//    edits to historic paystubs cannot rewrite older paystubs' YTD numbers.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import {
  calculatePaystub,
  seedContractorLines,
  seedEmployeeLines,
  r2,
} from "@/lib/payroll/engine";
import type {
  Driver,
  PaystubEarning,
  PaystubDeduction,
  PaystubTax,
  PaystubSettlementItem,
  PaystubStatus,
  PaymentMethod,
  WorkerType,
  PaystubEarningKind,
  PaystubDeductionKind,
  PaystubTaxKind,
  PaystubSettlementItemKind,
  PaystubSettlementItemDirection,
} from "@/lib/supabase/types";

// ---------- Tiny helpers ----------

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

function numRequired(
  formData: FormData,
  name: string,
  opts: { nonNegative?: boolean; label: string }
): number {
  const v = num(formData, name, opts);
  if (v === null) throw new FieldError(name, `${opts.label} is required.`);
  return v;
}

function date(formData: FormData, name: string, required = false): string | null {
  const raw = s(formData, name);
  if (!raw) {
    if (required) throw new FieldError(name, "Date required.");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new FieldError(name, "Date must be YYYY-MM-DD.");
  }
  return raw;
}

// ---------- Server-action result shape ----------

export type PaystubActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// =============================================================================
//  Create a new draft paystub
// =============================================================================
//
//  Inputs (form):
//    driver_id        UUID — required
//    pay_period_start YYYY-MM-DD — required
//    pay_period_end   YYYY-MM-DD — required
//    check_date       YYYY-MM-DD — optional (defaults to pay_period_end)
//    notes            string     — optional
//    load_ids         repeated   — optional, only used for 1099 contractors
// =============================================================================

export async function createPaystubAction(
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  let driverId: string;
  let periodStart: string;
  let periodEnd: string;
  let checkDate: string | null;
  let notes: string | null;
  let loadIds: string[] = [];

  try {
    driverId = s(formData, "driver_id") ?? "";
    if (!driverId) throw new FieldError("driver_id", "Pick a driver first.");
    periodStart = date(formData, "pay_period_start", true)!;
    periodEnd = date(formData, "pay_period_end", true)!;
    checkDate = date(formData, "check_date");
    notes = s(formData, "notes");
    loadIds = formData.getAll("load_ids").filter((v) => typeof v === "string") as string[];
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  if (new Date(periodEnd) < new Date(periodStart)) {
    return { ok: false, error: "Pay period end must be on or after start.", field: "pay_period_end" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Load the driver row to snapshot worker_type and seed lines
  const { data: driver, error: dErr } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();
  if (dErr) return { ok: false, error: dErr.message };
  if (!driver) return { ok: false, error: "Driver not found." };
  const d = driver as Driver;

  // Resolve worker_type for paystub — pick the driver's current value
  const workerType: WorkerType = (d.worker_type as WorkerType) ?? "1099";

  // For 1099, optionally pre-populate earnings from selected loads.
  let earningsSeed: ReturnType<typeof seedContractorLines>["earnings"] = [];
  if (workerType === "1099" && loadIds.length > 0) {
    const { data: loads, error: lErr } = await supabase
      .from("loads")
      .select("id, load_number, origin, destination, total_revenue, total_miles")
      .in("id", loadIds);
    if (lErr) return { ok: false, error: lErr.message };
    const seed = seedContractorLines(
      (loads ?? []) as Parameters<typeof seedContractorLines>[0]
    );
    earningsSeed = seed.earnings;
    // also add a chargeback / detention etc later via the editor.
  }

  // For W2, seed one row from the driver's compensation defaults.
  let w2Seed: ReturnType<typeof seedEmployeeLines>["earnings"] = [];
  if (workerType === "W2") {
    w2Seed = seedEmployeeLines(d).earnings;
  }

  // Insert paystub header (all totals = 0 for a draft)
  const { data: ps, error: psErr } = await supabase
    .from("paystubs")
    .insert({
      profile_id: user.id,
      driver_id: driverId,
      worker_type: workerType,
      pay_period_start: periodStart,
      pay_period_end: periodEnd,
      check_date: checkDate ?? periodEnd,
      status: "draft",
      notes,
      created_by_user_id: user.id,
      net_pay: 0,
    })
    .select("id")
    .single();
  if (psErr) return { ok: false, error: psErr.message };

  // Insert seeded earnings (1099 loads or W2 comp defaults)
  const earningsToInsert = [...earningsSeed, ...w2Seed].map((e) => ({
    paystub_id: ps.id,
    profile_id: user.id,
    kind: e.kind,
    label: e.label,
    amount: e.amount,
    is_taxable: e.is_taxable,
    hours: e.hours,
    units: e.units,
    rate: e.rate,
    load_id: e.load_id,
    notes: e.notes,
  }));
  if (earningsToInsert.length > 0) {
    const { error: eErr } = await supabase.from("paystub_earnings").insert(earningsToInsert);
    if (eErr) return { ok: false, error: eErr.message };
  }

  // Recompute totals from inserted lines (cheap — we have them in memory)
  await recomputeAndPersistTotals(supabase, ps.id);

  await logActivity(supabase, user.id, {
    entityType: "paystub",
    entityId: ps.id,
    action: "created",
    metadata: {
      label: `Draft paystub created`,
      driver_id: driverId,
      period_start: periodStart,
      period_end: periodEnd,
    },
  });

  revalidatePath("/payroll");
  redirect(`/payroll/${ps.id}?created=1`);
}

// =============================================================================
//  Update paystub header (period dates, check date, notes, payment_method)
// =============================================================================

export async function updatePaystubHeaderAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  if (!paystubId) return { ok: false, error: "Missing paystub id." };

  let periodStart: string;
  let periodEnd: string;
  let checkDate: string | null;
  let notes: string | null;
  let paymentMethod: PaymentMethod | null;
  let checkNumber: string | null;
  try {
    periodStart = date(formData, "pay_period_start", true)!;
    periodEnd = date(formData, "pay_period_end", true)!;
    checkDate = date(formData, "check_date");
    notes = s(formData, "notes");
    const pmRaw = s(formData, "payment_method");
    if (pmRaw && !["ach", "zelle", "cash", "check", "direct_deposit", "other"].includes(pmRaw)) {
      throw new FieldError("payment_method", "Invalid payment method.");
    }
    paymentMethod = (pmRaw as PaymentMethod) ?? null;
    checkNumber = s(formData, "check_number");
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  if (new Date(periodEnd) < new Date(periodStart)) {
    return { ok: false, error: "Pay period end must be on or after start.", field: "pay_period_end" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Only allow header edits while in draft
  const { data: existing } = await supabase
    .from("paystubs").select("status").eq("id", paystubId).maybeSingle();
  if (!existing) return { ok: false, error: "Paystub not found." };
  if ((existing as { status: PaystubStatus }).status !== "draft") {
    return { ok: false, error: "Only draft paystubs can be edited." };
  }

  const { error } = await supabase.from("paystubs").update({
    pay_period_start: periodStart,
    pay_period_end: periodEnd,
    check_date: checkDate ?? periodEnd,
    notes,
    payment_method: paymentMethod,
    check_number: checkNumber,
  }).eq("id", paystubId).eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

// =============================================================================
//  Add line items (one action per child table)
// =============================================================================

const EARNING_KINDS: ReadonlyArray<PaystubEarningKind> = [
  "regular","overtime","doubletime","holiday","sick","vacation","bonus","commission",
  "per_diem","mileage","per_load","settlement_gross","detention","layover","accessorial",
  "reimbursement","other",
];
const DEDUCTION_KINDS: ReadonlyArray<PaystubDeductionKind> = [
  "401k","401k_roth","health_premium","dental_premium","vision_premium",
  "hsa","fsa","commuter","life_insurance","disability",
  "garnishment","child_support","union_dues","loan_repayment","uniform",
  "advance_repayment","other",
];
const TAX_KINDS: ReadonlyArray<PaystubTaxKind> = [
  "federal_income","state_income","local_income",
  "social_security","medicare","medicare_additional",
  "sui","sdi","futa","suta","workers_comp","other",
];
const SETTLEMENT_ITEM_KINDS: ReadonlyArray<PaystubSettlementItemKind> = [
  "escrow_deposit","escrow_release","advance","advance_repayment","fuel_advance","fuel_deduction",
  "toll","maintenance","tire","permit","eld_lease","truck_lease","trailer_lease","plate",
  "insurance","occupational_accident","cargo_insurance","chargeback","damage","claim",
  "factoring_fee","dispatcher_fee","authority_fee","maintenance_reserve",
  "reimbursement","bonus","detention_pay","layover_pay","other",
];

/**
 * Look up the paystub, confirm it belongs to the current user (RLS handles
 * this implicitly via the SELECT), confirm status === 'draft', and return
 * its worker_type so callers can enforce W2- vs 1099-only line restrictions.
 */
async function assertEditable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paystubId: string
): Promise<{ worker_type: WorkerType }> {
  const { data } = await supabase
    .from("paystubs")
    .select("status, worker_type")
    .eq("id", paystubId)
    .maybeSingle();
  if (!data) throw new FieldError("paystub_id", "Paystub not found.");
  const row = data as { status: PaystubStatus; worker_type: WorkerType };
  if (row.status !== "draft") {
    throw new FieldError(
      "paystub_id",
      "Paystub is locked — only drafts can be edited."
    );
  }
  return { worker_type: row.worker_type };
}

export async function addEarningAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { worker_type } = await assertEditable(supabase, paystubId);
    const kind = s(formData, "kind") as PaystubEarningKind;
    if (!EARNING_KINDS.includes(kind)) throw new FieldError("kind", "Invalid kind.");
    // Cross-type guard: settlement_gross is a 1099-only concept; a per_diem
    // row only makes sense for W2. This keeps the printed paystubs sane.
    if (worker_type === "W2" && kind === "settlement_gross") {
      throw new FieldError("kind", "settlement_gross is only valid on 1099 paystubs.");
    }
    if (worker_type === "1099" && (kind === "per_diem" || kind === "regular" || kind === "overtime" || kind === "doubletime" || kind === "holiday" || kind === "sick" || kind === "vacation")) {
      throw new FieldError("kind", `${kind} is only valid on W2 paystubs.`);
    }
    const label = s(formData, "label") ?? kind;
    const hours = num(formData, "hours", { nonNegative: true, label: "Hours" });
    const units = num(formData, "units", { nonNegative: true, label: "Units" });
    const rate = num(formData, "rate", { nonNegative: true, label: "Rate" });
    let amount = num(formData, "amount", { nonNegative: true, label: "Amount" });
    if (amount === null) {
      // Auto-compute amount from hours*rate or units*rate if amount blank
      if (hours !== null && rate !== null) amount = r2(hours * rate);
      else if (units !== null && rate !== null) amount = r2(units * rate);
      else amount = 0;
    }
    // Checkboxes omit themselves from FormData when unchecked, so this
    // strictly checks for the truthy value rather than NOT-"false". A previous
    // version treated unchecked as taxable=true; this version respects the
    // user's uncheck for things like IRS-rate per-diem rows.
    const isTaxable = formData.get("is_taxable") === "true";
    const loadId = s(formData, "load_id");

    const { error } = await supabase.from("paystub_earnings").insert({
      paystub_id: paystubId,
      profile_id: user.id,
      kind, label, amount, is_taxable: isTaxable,
      hours, units, rate, load_id: loadId,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

export async function addDeductionAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { worker_type } = await assertEditable(supabase, paystubId);
    const kind = s(formData, "kind") as PaystubDeductionKind;
    if (!DEDUCTION_KINDS.includes(kind)) throw new FieldError("kind", "Invalid kind.");
    const label = s(formData, "label") ?? kind;
    const amount = numRequired(formData, "amount", { nonNegative: true, label: "Amount" });
    const isPreTax = formData.get("is_pre_tax") === "true";
    // Pre-tax deductions are a W2 concept. Block them on 1099 paystubs so a
    // taxable-wages calc never sneaks into a contractor settlement.
    if (worker_type === "1099" && isPreTax) {
      throw new FieldError(
        "is_pre_tax",
        "Pre-tax deductions are only allowed on W2 paystubs. Use post-tax instead, or add a settlement item."
      );
    }

    const { error } = await supabase.from("paystub_deductions").insert({
      paystub_id: paystubId,
      profile_id: user.id,
      kind, label, amount, is_pre_tax: isPreTax,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

export async function addTaxAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { worker_type } = await assertEditable(supabase, paystubId);
    // HARD GUARD: 1099 paystubs cannot have tax withholding rows — that's the
    // whole point of the classification.
    if (worker_type !== "W2") {
      throw new FieldError(
        "paystub_id",
        "Tax withholding is only allowed on W2 paystubs. 1099 contractors are paid gross."
      );
    }
    const kind = s(formData, "kind") as PaystubTaxKind;
    if (!TAX_KINDS.includes(kind)) throw new FieldError("kind", "Invalid kind.");
    const label = s(formData, "label") ?? kind;
    const jurisdiction = s(formData, "jurisdiction");
    const employee = num(formData, "employee_amount", { nonNegative: true, label: "Employee amount" }) ?? 0;
    const employer = num(formData, "employer_amount", { nonNegative: true, label: "Employer amount" }) ?? 0;

    const { error } = await supabase.from("paystub_taxes").insert({
      paystub_id: paystubId,
      profile_id: user.id,
      kind, label, jurisdiction,
      employee_amount: employee,
      employer_amount: employer,
      rate_basis: "manual",
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

export async function addSettlementItemAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { worker_type } = await assertEditable(supabase, paystubId);
    // HARD GUARD: W2 employees use the standard taxes + deductions model;
    // settlement items (escrow, factoring, fuel deductions) are a 1099-only
    // contractor mechanic. Block them on W2 paystubs.
    if (worker_type !== "1099") {
      throw new FieldError(
        "paystub_id",
        "Settlement items are only allowed on 1099 contractor paystubs. Use a deduction row on W2 paystubs."
      );
    }
    const kind = s(formData, "kind") as PaystubSettlementItemKind;
    if (!SETTLEMENT_ITEM_KINDS.includes(kind)) throw new FieldError("kind", "Invalid kind.");
    const label = s(formData, "label") ?? kind;
    const amount = numRequired(formData, "amount", { nonNegative: true, label: "Amount" });
    const directionRaw = s(formData, "direction");
    if (directionRaw !== "deduct" && directionRaw !== "add") {
      throw new FieldError("direction", "Direction must be 'deduct' or 'add'.");
    }
    const direction = directionRaw as PaystubSettlementItemDirection;
    const loadId = s(formData, "load_id");

    const { error } = await supabase.from("paystub_settlement_items").insert({
      paystub_id: paystubId,
      profile_id: user.id,
      kind, label, amount, direction, load_id: loadId,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

// =============================================================================
//  Add a LOAD to an existing draft paystub (1099 only)
// -----------------------------------------------------------------------------
//  Phase E4. Carrier picks loads at creation time on /payroll/new, but
//  sometimes a load is added later (broker re-bills, post-trip detention,
//  forgotten load). This action seeds one earnings row of kind
//  'settlement_gross' tied to load_id with the load's total_revenue.
//
//  Guards:
//    • draft only
//    • 1099 only (W2 paystubs don't carry settlement_gross lines)
//    • load must belong to the carrier (RLS-backed)
//    • load must not already be attached to this same paystub
// =============================================================================

export async function addLoadToDraftAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let loadId: string;
  try {
    const raw = s(formData, "load_id");
    if (!raw) throw new FieldError("load_id", "Pick a load to add.");
    loadId = raw;

    const { worker_type } = await assertEditable(supabase, paystubId);
    if (worker_type !== "1099") {
      throw new FieldError(
        "paystub_id",
        "Adding a load is a 1099 contractor settlement action. W2 paystubs use manual earnings rows."
      );
    }

    // Load ownership + payload
    const { data: load, error: lErr } = await supabase
      .from("loads")
      .select("id, load_number, origin, destination, total_revenue, total_miles")
      .eq("id", loadId)
      .maybeSingle();
    if (lErr) return { ok: false, error: lErr.message };
    if (!load) {
      return { ok: false, error: "Load not found or not in your account.", field: "load_id" };
    }

    // Already on this paystub?
    const { data: existing } = await supabase
      .from("paystub_earnings")
      .select("id")
      .eq("paystub_id", paystubId)
      .eq("load_id", loadId)
      .maybeSingle();
    if (existing) {
      return {
        ok: false,
        error: "This load is already on the draft. Remove it first if you want to re-add it.",
        field: "load_id",
      };
    }

    const route = [load.origin, load.destination].filter(Boolean).join(" → ");
    const label =
      load.load_number && route ? `Load #${load.load_number}  ${route}`
      : load.load_number          ? `Load #${load.load_number}`
      : route                     ? route
      : "Load";

    const { error } = await supabase.from("paystub_earnings").insert({
      paystub_id: paystubId,
      profile_id: user.id,
      kind: "settlement_gross",
      label,
      amount: r2(load.total_revenue ?? 0),
      is_taxable: true,
      hours: null,
      units: load.total_miles,
      rate: null,
      load_id: load.id,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

// =============================================================================
//  Update header (payment_method / check_number / notes) — DRAFT ONLY
// -----------------------------------------------------------------------------
//  Phase W3 step 1. Period dates are NOT editable here on purpose — they were
//  fixed at create time and changing them after seeding lines would require
//  re-seeding earnings. updatePaystubHeaderAction (above) still handles dates
//  but is not wired to UI today.
//
//  Why three fields specifically:
//    payment_method  — set ahead of issuing so the printed paystub displays it
//    check_number    — set when the carrier knows the actual check # they'll cut
//    notes           — internal scratch pad
//
//  Hard gates: auth → ownership (via RLS on the SELECT + explicit
//  .eq("profile_id", user.id) on the UPDATE) → status === 'draft'.
// =============================================================================

const PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  "ach", "zelle", "cash", "check", "direct_deposit", "other",
];

export async function updateDraftHeaderAction(
  paystubId: string,
  _prev: PaystubActionState | undefined,
  formData: FormData
): Promise<PaystubActionState> {
  if (!paystubId) return { ok: false, error: "Missing paystub id." };

  let paymentMethod: PaymentMethod | null;
  let checkNumber: string | null;
  let notes: string | null;
  try {
    const pmRaw = s(formData, "payment_method");
    if (pmRaw && !(PAYMENT_METHODS as ReadonlyArray<string>).includes(pmRaw)) {
      throw new FieldError(
        "payment_method",
        `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}.`
      );
    }
    paymentMethod = (pmRaw as PaymentMethod) ?? null;
    // s() already trims and converts empty strings to null
    checkNumber = s(formData, "check_number");
    notes = s(formData, "notes");
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Status gate — only drafts can have their header edited
  const { data: existing } = await supabase
    .from("paystubs")
    .select("status")
    .eq("id", paystubId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Paystub not found." };
  if ((existing as { status: PaystubStatus }).status !== "draft") {
    return {
      ok: false,
      error: "Only draft paystubs can be edited. Void this paystub and re-issue if you need to change it.",
    };
  }

  const { error } = await supabase
    .from("paystubs")
    .update({
      payment_method: paymentMethod,
      check_number: checkNumber,
      notes,
    })
    .eq("id", paystubId)
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystubId}`);
  return { ok: true };
}

// =============================================================================
//  Void-returning wrappers for direct <form action={...}> use in Server
//  Components. These throw on validation/DB error and surface via Next.js
//  error boundary; they're used by the editor's inline add-row forms because
//  those forms can't easily wire useActionState from a Server Component.
// =============================================================================

export async function addEarning(paystubId: string, formData: FormData): Promise<void> {
  const r = await addEarningAction(paystubId, undefined, formData);
  if (!r.ok) throw new Error(r.error);
}
export async function addDeduction(paystubId: string, formData: FormData): Promise<void> {
  const r = await addDeductionAction(paystubId, undefined, formData);
  if (!r.ok) throw new Error(r.error);
}
export async function addTax(paystubId: string, formData: FormData): Promise<void> {
  const r = await addTaxAction(paystubId, undefined, formData);
  if (!r.ok) throw new Error(r.error);
}
export async function addSettlementItem(paystubId: string, formData: FormData): Promise<void> {
  const r = await addSettlementItemAction(paystubId, undefined, formData);
  if (!r.ok) throw new Error(r.error);
}
export async function addLoadToDraft(paystubId: string, formData: FormData): Promise<void> {
  const r = await addLoadToDraftAction(paystubId, undefined, formData);
  if (!r.ok) throw new Error(r.error);
}

// =============================================================================
//  Remove a line item (one shared action — table inferred from form input)
// =============================================================================

const LINE_TABLES = ["paystub_earnings", "paystub_deductions", "paystub_taxes", "paystub_settlement_items"] as const;
type LineTable = (typeof LINE_TABLES)[number];

export async function removeLineAction(
  paystubId: string,
  table: LineTable,
  lineId: string
): Promise<void> {
  if (!LINE_TABLES.includes(table)) throw new Error("Invalid line table.");
  if (!lineId) throw new Error("Missing line id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // Status guard
  const { data: ps } = await supabase.from("paystubs").select("status").eq("id", paystubId).maybeSingle();
  if (!ps) throw new Error("Paystub not found.");
  if ((ps as { status: PaystubStatus }).status !== "draft") {
    throw new Error("Paystub is locked — only drafts can be edited.");
  }

  const { error } = await supabase.from(table).delete()
    .eq("id", lineId).eq("paystub_id", paystubId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await recomputeAndPersistTotals(supabase, paystubId);
  revalidatePath(`/payroll/${paystubId}`);
}

// =============================================================================
//  Recompute totals from current child rows + persist on the paystub row
// =============================================================================

async function recomputeAndPersistTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paystubId: string
): Promise<void> {
  // Load all children + the parent's worker_type
  const [{ data: psRow }, { data: earnings }, { data: deductions }, { data: taxes }, { data: items }] =
    await Promise.all([
      supabase.from("paystubs").select("worker_type").eq("id", paystubId).maybeSingle(),
      supabase.from("paystub_earnings").select("amount,is_taxable").eq("paystub_id", paystubId),
      supabase.from("paystub_deductions").select("amount,is_pre_tax").eq("paystub_id", paystubId),
      supabase.from("paystub_taxes").select("employee_amount,employer_amount").eq("paystub_id", paystubId),
      supabase.from("paystub_settlement_items").select("amount,direction").eq("paystub_id", paystubId),
    ]);

  if (!psRow) return;
  const totals = calculatePaystub({
    worker_type: (psRow as { worker_type: WorkerType }).worker_type,
    earnings: (earnings ?? []) as Array<Pick<PaystubEarning, "amount" | "is_taxable">>,
    deductions: (deductions ?? []) as Array<Pick<PaystubDeduction, "amount" | "is_pre_tax">>,
    taxes: (taxes ?? []) as Array<Pick<PaystubTax, "employee_amount" | "employer_amount">>,
    settlement_items: (items ?? []) as Array<Pick<PaystubSettlementItem, "amount" | "direction">>,
  });

  await supabase.from("paystubs").update({
    gross_earnings: totals.gross_earnings,
    total_pretax_deductions: totals.total_pretax_deductions,
    taxable_wages: totals.taxable_wages,
    total_taxes_withheld: totals.total_taxes_withheld,
    total_posttax_deductions: totals.total_posttax_deductions,
    total_reimbursements: totals.total_reimbursements,
    total_settlement_deductions: totals.total_settlement_deductions,
    net_pay: totals.net_pay,
  }).eq("id", paystubId);
}

// =============================================================================
//  Issue: lock the paystub, snapshot YTD, assign paystub_number
// =============================================================================

export async function issuePaystubAction(paystubId: string): Promise<void> {
  if (!paystubId) throw new Error("Missing paystub id.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // Refresh totals once before issuing (in case child rows were edited
  // directly outside the line-add actions).
  await recomputeAndPersistTotals(supabase, paystubId);

  // Pull the now-current header
  const { data: ps } = await supabase.from("paystubs").select("*").eq("id", paystubId).maybeSingle();
  if (!ps) throw new Error("Paystub not found.");
  const header = ps as {
    id: string; driver_id: string; status: PaystubStatus;
    check_date: string | null; pay_period_end: string;
    gross_earnings: number; taxable_wages: number | null;
    total_taxes_withheld: number; net_pay: number;
  };
  if (header.status !== "draft") throw new Error("Already issued.");

  const checkDate = header.check_date ?? header.pay_period_end;
  const year = new Date(checkDate).getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  // YTD = sum of issued paystubs in the same year for this driver + this one
  const { data: priorPaystubs } = await supabase
    .from("paystubs")
    .select("gross_earnings, taxable_wages, total_taxes_withheld, net_pay, check_date")
    .eq("driver_id", header.driver_id)
    .eq("status", "issued")
    .neq("id", paystubId)
    .gte("check_date", yearStart)
    .lte("check_date", yearEnd);

  const ytdGross = (priorPaystubs ?? []).reduce((a, r) => a + (r.gross_earnings ?? 0), 0) + header.gross_earnings;
  const ytdTaxable = (priorPaystubs ?? []).reduce((a, r) => a + (r.taxable_wages ?? 0), 0) + (header.taxable_wages ?? 0);
  const ytdTaxes = (priorPaystubs ?? []).reduce((a, r) => a + (r.total_taxes_withheld ?? 0), 0) + header.total_taxes_withheld;
  const ytdNet = (priorPaystubs ?? []).reduce((a, r) => a + (r.net_pay ?? 0), 0) + header.net_pay;

  // paystub_number: PS-YYYY-NNNNN (next-highest existing for this profile in year)
  const { data: maxRow } = await supabase
    .from("paystubs")
    .select("paystub_number")
    .eq("profile_id", user.id)
    .like("paystub_number", `PS-${year}-%`)
    .order("paystub_number", { ascending: false })
    .limit(1);
  let nextSeq = 1;
  if (maxRow && maxRow[0]?.paystub_number) {
    const tail = String(maxRow[0].paystub_number).split("-")[2];
    const parsed = Number(tail);
    if (Number.isFinite(parsed)) nextSeq = parsed + 1;
  }
  const paystubNumber = `PS-${year}-${String(nextSeq).padStart(5, "0")}`;

  const { error } = await supabase.from("paystubs").update({
    status: "issued",
    paystub_number: paystubNumber,
    check_date: checkDate,
    ytd_gross_earnings: r2(ytdGross),
    ytd_taxable_wages: r2(ytdTaxable),
    ytd_taxes_withheld: r2(ytdTaxes),
    ytd_net_pay: r2(ytdNet),
  }).eq("id", paystubId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "paystub",
    entityId: paystubId,
    action: "issued",
    metadata: {
      label: `Paystub ${paystubNumber} issued`,
      amount: header.net_pay,
      driver_id: header.driver_id,
      paystub_number: paystubNumber,
    },
  });

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystubId}`);
}

// =============================================================================
//  Void: reverse an issued paystub. Keeps the row + line items for audit but
//        flips status. Future enhancement: roll back escrow_balance.
// =============================================================================

export async function voidPaystubAction(paystubId: string): Promise<void> {
  if (!paystubId) throw new Error("Missing paystub id.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase.from("paystubs").update({ status: "voided" })
    .eq("id", paystubId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "paystub",
    entityId: paystubId,
    action: "voided",
  });

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystubId}`);
}

export async function markPaidAction(paystubId: string): Promise<void> {
  if (!paystubId) throw new Error("Missing paystub id.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase.from("paystubs").update({ status: "paid" })
    .eq("id", paystubId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "paystub",
    entityId: paystubId,
    action: "paid",
  });

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystubId}`);
}

// =============================================================================
//  Delete draft (only drafts may be deleted)
// =============================================================================

export async function deleteDraftAction(paystubId: string): Promise<void> {
  if (!paystubId) throw new Error("Missing paystub id.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: ps } = await supabase.from("paystubs").select("status").eq("id", paystubId).maybeSingle();
  if (!ps) throw new Error("Paystub not found.");
  if ((ps as { status: PaystubStatus }).status !== "draft") {
    throw new Error("Only drafts can be deleted.");
  }

  const { error } = await supabase.from("paystubs").delete()
    .eq("id", paystubId).eq("profile_id", user.id);
  if (error) throw new Error(error.message);

  await logActivity(supabase, user.id, {
    entityType: "paystub",
    entityId: paystubId,
    action: "deleted",
  });

  revalidatePath("/payroll");
  redirect("/payroll");
}
