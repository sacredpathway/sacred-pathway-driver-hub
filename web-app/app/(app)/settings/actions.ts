// =============================================================================
//  Settings server actions — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  All writes for /settings + /settings/paystub. Same defense pattern as
//  drivers/loads/payroll actions:
//    auth.getUser()  →
//    server-side validation  →
//    UPDATE with explicit .eq("id", user.id) (RLS is the backstop).
//
//  Logo upload uses the private `branding` Storage bucket. Object key is
//  always "<profile_id>/logo.<ext>" so the bucket-level RLS prefix policy
//  enforces ownership without any per-object metadata.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { PAYSTUB_THEMES, type PaystubTheme } from "@/lib/supabase/types";

// -----------------------------------------------------------------------------
// Validation helpers (same shape as drivers/loads actions)
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

function num(
  formData: FormData,
  name: string,
  opts?: { nonNegative?: boolean; max?: number; label?: string }
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
  if (opts?.max !== undefined && n > opts.max) {
    throw new FieldError(
      name,
      `${opts?.label ?? name} cannot be more than ${opts.max}.`
    );
  }
  return n;
}

// US state abbreviation (kept light — no zod dep)
function maybeState(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  if (!/^[A-Za-z]{2}$/.test(raw)) {
    throw new FieldError(name, "State must be a 2-letter code (e.g. TX, FL).");
  }
  return raw.toUpperCase();
}

// EIN format: XX-XXXXXXX (9 digits with a dash) — strip and re-insert.
function maybeEin(formData: FormData, name: string): string | null {
  const raw = s(formData, name);
  if (raw === null) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length !== 9) {
    throw new FieldError(name, "EIN must be 9 digits (XX-XXXXXXX).");
  }
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export type SettingsActionState =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// =============================================================================
//  COMPANY PROFILE — name, MC/DOT, EIN, address, phone
// =============================================================================

export async function updateCompanyProfileAction(
  _prev: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  let payload: {
    company_name: string | null;
    mc_number: string | null;
    dot_number: string | null;
    phone: string | null;
    company_address: string | null;
    company_city: string | null;
    company_state: string | null;
    company_zip: string | null;
    company_ein: string | null;
  };

  try {
    payload = {
      company_name:    s(formData, "company_name"),
      mc_number:       s(formData, "mc_number"),
      dot_number:      s(formData, "dot_number"),
      phone:           s(formData, "phone"),
      company_address: s(formData, "company_address"),
      company_city:    s(formData, "company_city"),
      company_state:   maybeState(formData, "company_state"),
      company_zip:     s(formData, "company_zip"),
      company_ein:     maybeEin(formData, "company_ein"),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  // Branding (company name) renders in the nav on every page — invalidate
  // the whole tree so the header refreshes immediately.
  revalidatePath("/", "layout");
  return { ok: true };
}

// =============================================================================
//  PAYSTUB PREFERENCES — theme, footer legal, fee defaults
// =============================================================================

export async function updatePaystubPrefsAction(
  _prev: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  let payload: {
    paystub_theme: PaystubTheme | null;
    paystub_footer_legal: string | null;
    driver_pay_percentage: number | null;
    dispatcher_fee_percentage: number | null;
    factoring_fee_percentage: number | null;
    authority_fee: number | null;
    maintenance_reserve: number | null;
  };

  try {
    const themeRaw = s(formData, "paystub_theme");
    if (themeRaw && !(PAYSTUB_THEMES as ReadonlyArray<string>).includes(themeRaw)) {
      throw new FieldError(
        "paystub_theme",
        `Theme must be one of: ${PAYSTUB_THEMES.join(", ")}.`
      );
    }

    payload = {
      paystub_theme:             (themeRaw as PaystubTheme | null) ?? null,
      paystub_footer_legal:      s(formData, "paystub_footer_legal"),
      driver_pay_percentage:     num(formData, "driver_pay_percentage",
                                     { nonNegative: true, max: 100, label: "Driver pay %" }),
      dispatcher_fee_percentage: num(formData, "dispatcher_fee_percentage",
                                     { nonNegative: true, max: 100, label: "Dispatcher fee %" }),
      factoring_fee_percentage:  num(formData, "factoring_fee_percentage",
                                     { nonNegative: true, max: 100, label: "Factoring fee %" }),
      authority_fee:             num(formData, "authority_fee",
                                     { nonNegative: true, label: "Authority fee" }),
      maintenance_reserve:       num(formData, "maintenance_reserve",
                                     { nonNegative: true, label: "Maintenance reserve" }),
    };
  } catch (e) {
    if (e instanceof FieldError) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: (e as Error).message };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/paystub");
  revalidatePath("/settings");
  return { ok: true };
}

// =============================================================================
//  LOGO UPLOAD — POSTs a single file to storage, updates profiles.logo_storage_path
// -----------------------------------------------------------------------------
//  Validation:
//    • <= 5 MB (bucket also enforces)
//    • image/{png,jpeg,jpg,webp,svg+xml} (bucket also enforces)
//    • upserts to "<profile_id>/logo.<ext>" — single canonical logo per carrier.
// =============================================================================

const ALLOWED_LOGO_MIMES: ReadonlyArray<string> = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
];

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":     return "png";
    case "image/jpeg":    return "jpg";
    case "image/jpg":     return "jpg";
    case "image/webp":    return "webp";
    case "image/svg+xml": return "svg";
    default:              return "png";
  }
}

export async function uploadLogoAction(
  _prev: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick an image to upload.", field: "logo" };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "Logo must be 5 MB or smaller.", field: "logo" };
  }
  if (!ALLOWED_LOGO_MIMES.includes(file.type)) {
    return {
      ok: false,
      error: "Logo must be PNG, JPG, WebP, or SVG.",
      field: "logo",
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // RLS on storage.objects requires (storage.foldername(name))[1] = auth.uid()::text.
  // Swift UUIDs are uppercase, Postgres auth.uid()::text is lowercase — always
  // build storage paths with lowercase UUIDs to avoid 403s on the policy check.
  const profileId = user.id.toLowerCase();
  const path = `${profileId}/logo.${extFromMime(file.type)}`;

  const { error: upErr } = await supabase
    .storage
    .from("branding")
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await supabase
    .from("profiles")
    .update({ logo_storage_path: path })
    .eq("id", user.id);
  if (dbErr) return { ok: false, error: dbErr.message };

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

// =============================================================================
//  DELETE LOGO — removes the storage object + nulls the profile column.
// -----------------------------------------------------------------------------
//  Form-action variant (no useActionState) — wired directly to <form>.
// =============================================================================

export async function deleteLogoAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("logo_storage_path")
    .eq("id", user.id)
    .maybeSingle();

  const path = profile?.logo_storage_path as string | null | undefined;
  if (path) {
    // Storage delete failures are logged but non-fatal — if the object is
    // already gone we still want to clear the DB column.
    await supabase.storage.from("branding").remove([path]);
  }

  await supabase
    .from("profiles")
    .update({ logo_storage_path: null })
    .eq("id", user.id);

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}
