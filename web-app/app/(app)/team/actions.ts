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
