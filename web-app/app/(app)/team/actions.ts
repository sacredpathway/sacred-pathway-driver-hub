// =============================================================================
//  Team server actions — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Carrier admin actions on the /team page:
//    • createInviteAction       — generate an invite (email or open code)
//    • revokeInviteAction       — revoke an open invite
//    • removeMemberAction       — revoke an active member's sponsorship
//
//  All gated by resolveAccess → must be carrier_admin. RLS enforces the
//  carrier_profile_id scope; this layer just rejects non-admins early.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveAccess } from "@/lib/entitlement/resolver";
import { logActivity } from "@/lib/activity/log";
import { sendInviteEmail, getAppBaseUrl } from "@/lib/email/sendInviteEmail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamActionState =
  | { ok: true; invite_code?: string }
  | { ok: false; error: string; field?: string };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function s(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/**
 * Generate an uppercase invite code like "DRV-A3F9". Stable shape: 4 char
 * suffix from a 32-char alphabet that strips ambiguous glyphs (no 0/O/1/I).
 */
function newInviteCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `DRV-${suffix}`;
}

async function requireCarrierAdmin() {
  const supabase = await createClient();
  const entitlement = await resolveAccess(supabase);
  if (entitlement.accessLevel !== "carrier_admin" || !entitlement.carrierProfileId) {
    return { supabase, entitlement, error: "carrier_admin required" as const };
  }
  return { supabase, entitlement, error: null };
}

// =============================================================================
//  CREATE INVITE
// =============================================================================

export async function createInviteAction(
  _prev: TeamActionState | undefined,
  formData: FormData
): Promise<TeamActionState> {
  const gate = await requireCarrierAdmin();
  if (gate.error) return { ok: false, error: gate.error };
  const { supabase, entitlement } = gate;

  const email = s(formData, "email");
  // Light validation — we don't reject "weird" emails because the carrier
  // might be inviting a federated identity that doesn't match a basic regex.
  if (email && !email.includes("@")) {
    return { ok: false, error: "Email must contain '@'.", field: "email" };
  }

  // max_uses: default 1 for email invites, 10 for open shareable links.
  const maxUsesRaw = s(formData, "max_uses");
  let maxUses = maxUsesRaw ? Number(maxUsesRaw) : email ? 1 : 10;
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 1000) {
    maxUses = email ? 1 : 10;
  }

  // expires_at: optional, in days from now (default 30 days).
  const expiresDaysRaw = s(formData, "expires_days");
  let expiresDays = expiresDaysRaw ? Number(expiresDaysRaw) : 30;
  if (!Number.isFinite(expiresDays) || expiresDays < 1) expiresDays = 30;
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();

  // Code-collision retry: 4 chars × 32 alphabet = 1M codes per carrier.
  // Collisions inside a single carrier are vanishingly rare but cheap to retry.
  let code = newInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: clash } = await supabase
      .from("carrier_invites")
      .select("id")
      .eq("invite_code", code)
      .maybeSingle();
    if (!clash) break;
    code = newInviteCode();
  }

  const { error } = await supabase.from("carrier_invites").insert({
    carrier_profile_id: entitlement.carrierProfileId,
    invite_code: code,
    email,
    role: "driver",
    created_by_user_id: entitlement.userId,
    max_uses: maxUses,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, entitlement.carrierProfileId!, {
    entityType: "profile",
    entityId: null,
    action: "branding_updated",  // reused; not worth a new enum case for invites
    metadata: { label: `Driver invite created${email ? ` for ${email}` : ""} (code ${code})`, invite_code: code },
  });

  revalidatePath("/team");
  return { ok: true, invite_code: code };
}

// =============================================================================
//  REVOKE INVITE
// =============================================================================

export async function revokeInviteAction(inviteId: string): Promise<void> {
  if (!inviteId || !UUID_RE.test(inviteId)) throw new Error("Missing or invalid invite id.");
  const gate = await requireCarrierAdmin();
  if (gate.error) throw new Error(gate.error);
  const { supabase, entitlement } = gate;

  const { error } = await supabase
    .from("carrier_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("carrier_profile_id", entitlement.carrierProfileId);
  if (error) throw new Error(error.message);

  revalidatePath("/team");
}

// =============================================================================
//  REMOVE MEMBER (revoke sponsorship)
// -----------------------------------------------------------------------------
//  Setting status='removed' immediately demotes the driver in the resolver.
//  We DO NOT delete their data; the carrier may want to re-add them later.
// =============================================================================

export async function removeMemberAction(memberId: string): Promise<void> {
  if (!memberId || !UUID_RE.test(memberId)) throw new Error("Missing or invalid member id.");
  const gate = await requireCarrierAdmin();
  if (gate.error) throw new Error(gate.error);
  const { supabase, entitlement } = gate;

  const { error } = await supabase
    .from("carrier_members")
    .update({
      status: "removed",
      removed_at: new Date().toISOString(),
      removed_by_user_id: entitlement.userId,
    })
    .eq("id", memberId)
    .eq("carrier_profile_id", entitlement.carrierProfileId);
  if (error) throw new Error(error.message);

  revalidatePath("/team");
}

// =============================================================================
//  INVITE DRIVER — full driver-info onboarding
// -----------------------------------------------------------------------------
//  The "proper" driver invite workflow per spec:
//    1. Carrier enters driver name, email, phone (optional), worker_type,
//       pay_type (percent | mileage), pay value, notes (optional).
//    2. We upsert a public.drivers roster row for that carrier+email so the
//       driver row exists BEFORE acceptance (reuse if already there).
//    3. We reuse any open active invite already pointed at the same
//       (carrier, email) instead of creating a duplicate.
//    4. We create the invite with linked_driver_id set so accept_carrier_invite
//       can copy it into carrier_members on acceptance.
//    5. We email the invite via sendInviteEmail. If env vars are missing,
//       email is skipped and the action surfaces the link for manual copy.
//
//  Safety:
//    • Email normalized lowercase before any lookup or persistence.
//    • Driver row "reuse" matches on (carrier_profile_id, lower(email)).
//    • Pay shape:
//        - "percent" → pay_type='percent', pay_percentage=X, mileage_rate=NULL
//        - "mileage" → pay_type='percent' (legacy default for iOS compat),
//                      mileage_rate=X, comp_type='mileage'
//      iOS SettlementEngine reads pay_type+pay_percentage so a mileage
//      driver shows as 0% until the carrier sets a value via the driver
//      detail screen — by design, doesn't break iOS.
//    • All writes scoped to entitlement.carrierProfileId via .eq() belt +
//      RLS suspenders.
//    • NEVER creates an auth.users row. The driver creates their own auth
//      via the existing /auth/signin → /join/<code> flow.
// =============================================================================

export type InviteDriverActionState =
  | {
      ok: true;
      invite_code: string;
      invite_url: string;
      driver_id: string;
      email_sent: boolean;
      email_reason: string;
      reused_invite: boolean;
      reused_driver: boolean;
    }
  | { ok: false; error: string; field?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITE_EXPIRY_DAYS = 30;

export async function inviteDriverAction(
  _prev: InviteDriverActionState | undefined,
  formData: FormData
): Promise<InviteDriverActionState> {
  const gate = await requireCarrierAdmin();
  if (gate.error) return { ok: false, error: gate.error };
  const { supabase, entitlement } = gate;
  const carrierId = entitlement.carrierProfileId!;

  // ---- input ----
  const name        = s(formData, "name");
  const emailRaw    = s(formData, "email");
  const phone       = s(formData, "phone");
  const workerType  = s(formData, "worker_type");
  const payTypeUI   = s(formData, "pay_type");
  const payValueRaw = s(formData, "pay_value");
  const notes       = s(formData, "notes"); // stored on invite, not driver
                                             // (drivers table has no notes col)

  if (!name)                                  return { ok: false, error: "Driver name is required.",            field: "name" };
  if (!emailRaw)                              return { ok: false, error: "Driver email is required.",           field: "email" };
  const email = emailRaw.toLowerCase();
  if (!EMAIL_RE.test(email))                  return { ok: false, error: "Driver email looks malformed.",       field: "email" };
  if (workerType !== "1099" && workerType !== "W2")
    return { ok: false, error: "Worker type must be 1099 or W2.",     field: "worker_type" };
  if (payTypeUI !== "percent" && payTypeUI !== "mileage")
    return { ok: false, error: "Pay type must be percent or rate per mile.", field: "pay_type" };

  // Pay value optional — carrier can leave blank and set it later on the
  // driver detail screen. Only validate format if provided.
  let payValue: number | null = null;
  if (payValueRaw) {
    const cleaned = payValueRaw.replace(/[$,%\s]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Pay value must be a non-negative number.", field: "pay_value" };
    }
    payValue = n;
  }

  // ---- 1. Reuse-or-insert the drivers roster row ----
  const { data: existingDriverRaw, error: dLookupErr } = await supabase
    .from("drivers")
    .select("id")
    .eq("profile_id", carrierId)
    .ilike("email", email)
    .maybeSingle();
  if (dLookupErr) return { ok: false, error: dLookupErr.message };

  // Build the writable shape — for either insert OR update.
  const driverPayload: Record<string, unknown> = {
    name,
    email,
    phone:        phone ?? null,
    worker_type:  workerType,
    active:       true,
  };
  if (payTypeUI === "percent") {
    driverPayload.pay_type       = "percent";
    driverPayload.pay_percentage = payValue;
    driverPayload.mileage_rate   = null;
  } else {
    // "mileage" — store as legacy pay_type='percent' to avoid breaking
    // iOS SettlementEngine which checks for 'flat' vs anything-else.
    // Comp_type='mileage' is the new field that signals the actual pay
    // basis. mileage_rate stores the dollar amount.
    driverPayload.pay_type       = "percent";
    driverPayload.pay_percentage = 0;
    driverPayload.mileage_rate   = payValue;
    driverPayload.comp_type      = "mileage";
  }

  let driverId: string;
  let reusedDriver = false;

  if (existingDriverRaw) {
    reusedDriver = true;
    driverId = (existingDriverRaw as { id: string }).id;
    // Update (no historical fields wiped — only the writable shape).
    const { error: updErr } = await supabase
      .from("drivers")
      .update(driverPayload)
      .eq("id", driverId)
      .eq("profile_id", carrierId);
    if (updErr) return { ok: false, error: updErr.message };
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("drivers")
      .insert({ ...driverPayload, profile_id: carrierId })
      .select("id")
      .single();
    if (insErr) return { ok: false, error: insErr.message };
    driverId = inserted.id;
  }

  // ---- 2. Reuse-or-create the invite ----
  // "Open + matches this email" → reuse to keep the carrier from sending
  // duplicate codes. We don't touch invites for OTHER emails.
  const nowIso = new Date().toISOString();
  const { data: existingInviteRaw, error: iLookupErr } = await supabase
    .from("carrier_invites")
    .select("*")
    .eq("carrier_profile_id", carrierId)
    .ilike("email", email)
    .is("revoked_at", null)
    .gte("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (iLookupErr) return { ok: false, error: iLookupErr.message };

  let inviteCode: string;
  let reusedInvite = false;

  if (existingInviteRaw) {
    const existing = existingInviteRaw as {
      id: string; invite_code: string; use_count: number; max_uses: number; linked_driver_id: string | null;
    };
    if (existing.use_count >= existing.max_uses) {
      // Reuse-target is out of uses — fall through and create a new one.
    } else {
      reusedInvite = true;
      inviteCode = existing.invite_code;
      // Back-fill linked_driver_id if missing (older invites had none).
      if (!existing.linked_driver_id) {
        await supabase
          .from("carrier_invites")
          .update({ linked_driver_id: driverId })
          .eq("id", existing.id)
          .eq("carrier_profile_id", carrierId);
      }
    }
  }

  if (!reusedInvite) {
    // Generate a new code with up-to-5 collision retries (same shape as
    // the legacy createInviteAction).
    let code = newInviteCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: clash } = await supabase
        .from("carrier_invites")
        .select("id")
        .eq("invite_code", code)
        .maybeSingle();
      if (!clash) break;
      code = newInviteCode();
    }
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: insErr } = await supabase
      .from("carrier_invites")
      .insert({
        carrier_profile_id: carrierId,
        invite_code:        code,
        email,
        role:               "driver",
        created_by_user_id: entitlement.userId,
        max_uses:           1,                 // email-scoped invites are single-use
        expires_at:         expiresAt,
        linked_driver_id:   driverId,
        notes:              notes ?? null,
      });
    if (insErr) return { ok: false, error: insErr.message };
    inviteCode = code;
  }

  // After both branches `inviteCode` is guaranteed assigned. TS can't see
  // that across the branches; assert by reading the variable that must be set.
  const finalCode: string = inviteCode!;

  // ---- 3. Send email ----
  const inviteUrl = `${getAppBaseUrl()}/join/${finalCode}`;
  const carrierName = entitlement.carrierCompanyName?.trim() || "A Carrier";
  const emailResult = await sendInviteEmail({
    toEmail:     email,
    toName:      name,
    carrierName,
    inviteCode:  finalCode,
    inviteUrl,
  });

  // ---- 4. Activity + revalidate ----
  await logActivity(supabase, carrierId, {
    entityType: "driver",
    entityId:   driverId,
    action:     "created",
    metadata: {
      label: `Driver invite sent to ${email}${emailResult.sent ? "" : " (email skipped: " + emailResult.reason + ")"}`,
      invite_code: finalCode,
      reused_driver: reusedDriver,
      reused_invite: reusedInvite,
    },
  });

  revalidatePath("/team");

  return {
    ok: true,
    invite_code:   finalCode,
    invite_url:    inviteUrl,
    driver_id:     driverId,
    email_sent:    emailResult.sent,
    email_reason:  emailResult.reason,
    reused_invite: reusedInvite,
    reused_driver: reusedDriver,
  };
}
