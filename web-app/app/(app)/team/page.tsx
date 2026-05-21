// =============================================================================
//  /team — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Carrier-admin-only page. Two sections:
//    • Invite drivers (form)
//    • Roster: active + removed members
//    • Outstanding invites: open invite codes / shareable links
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveAccess } from "@/lib/entitlement/resolver";
import { redirect } from "next/navigation";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import type {
  CarrierInvite,
  CarrierMember,
  Profile,
} from "@/lib/supabase/types";
import InviteForm from "./InviteForm";
import RemoveMemberButton from "./RemoveMemberButton";
import RevokeInviteButton from "./RevokeInviteButton";

export const runtime = "edge";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const entitlement = await resolveAccess(supabase);

  // Hard gate — only carrier admins reach this page. Outside drivers and
  // carrier_drivers get bounced to dashboard.
  if (entitlement.accessLevel !== "carrier_admin") {
    redirect("/dashboard");
  }

  const [{ data: membersRaw }, { data: invitesRaw }] = await Promise.all([
    supabase
      .from("carrier_members")
      .select("*")
      .order("joined_at", { ascending: false }),
    supabase
      .from("carrier_invites")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  const members = (membersRaw ?? []) as CarrierMember[];
  const invites = (invitesRaw ?? []) as CarrierInvite[];

  // Need a name for each member — pull profiles for the linked user_ids.
  const userIds = [...new Set(members.map((m) => m.user_id))];
  let userMap = new Map<string, Pick<Profile, "id" | "company_name">>();
  if (userIds.length > 0) {
    const { data: profilesRaw } = await supabase
      .from("profiles")
      .select("id, company_name")
      .in("id", userIds);
    for (const p of (profilesRaw ?? []) as Pick<Profile, "id" | "company_name">[]) {
      userMap.set(p.id, p);
    }
  }

  const activeMembers = members.filter((m) => m.status === "active");
  const removedMembers = members.filter((m) => m.status === "removed");

  const now = new Date();
  const openInvites = invites.filter(
    (i) =>
      !i.revoked_at &&
      i.use_count < i.max_uses &&
      (!i.expires_at || new Date(i.expires_at) > now)
  );
  const inactiveInvites = invites.filter((i) => !openInvites.includes(i));

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Invite drivers to your carrier. Sponsored drivers get Basic Driver
            access included with your Carrier subscription — no separate $4.99/mo
            charge.
          </p>
        </div>
      </header>

      {sp.created && (
        <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Invite created. Share the code or the link below.
        </div>
      )}

      {/* Invite form */}
      <InviteForm />

      {/* Open invites */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Open invites</h2>
        {openInvites.length === 0 ? (
          <EmptyState
            title="No open invites"
            body="Create one above to start inviting drivers."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2 text-right">Uses</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Link</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-sp-card/30">
                {openInvites.map((i) => (
                  <tr key={i.id}>
                    <td className="px-3 py-2 font-mono font-semibold text-sp-gold">
                      {i.invite_code}
                    </td>
                    <td className="px-3 py-2 text-sp-textSecondary">
                      {i.email ?? "Open invite"}
                    </td>
                    <td className="px-3 py-2 text-right text-sp-textSecondary">
                      {i.use_count} / {i.max_uses}
                    </td>
                    <td className="px-3 py-2 text-sp-textSecondary">
                      {formatDate(i.expires_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-sp-textSecondary">
                      /join/{i.invite_code}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RevokeInviteButton inviteId={i.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Active drivers */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-sp-textPrimary">
          Active drivers ({activeMembers.length})
        </h2>
        {activeMembers.length === 0 ? (
          <EmptyState
            title="No drivers yet"
            body="Once a driver accepts an invite they'll appear here with Carrier sponsorship active."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
                <tr>
                  <th className="px-3 py-2">Driver (user id)</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-sp-card/30">
                {activeMembers.map((m) => {
                  const profile = userMap.get(m.user_id);
                  return (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-medium text-sp-textPrimary">
                        <span className="font-mono text-[11px] text-sp-textSecondary">
                          {profile?.company_name ?? m.user_id.slice(0, 8) + "…"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sp-textSecondary">{m.role}</td>
                      <td className="px-3 py-2 text-sp-textSecondary">
                        {formatDate(m.joined_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RemoveMemberButton memberId={m.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Removed drivers (audit) */}
      {removedMembers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-sp-textSecondary">
            Previously removed ({removedMembers.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-sp-card text-left text-[11px] uppercase tracking-wide text-sp-textSecondary">
                <tr>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Removed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-sp-card/30">
                {removedMembers.map((m) => (
                  <tr key={m.id} className="opacity-60">
                    <td className="px-3 py-2 font-mono text-[11px] text-sp-textSecondary">
                      {m.user_id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 text-sp-textSecondary">
                      {formatDate(m.joined_at)}
                    </td>
                    <td className="px-3 py-2 text-sp-textSecondary">
                      {formatDate(m.removed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inactiveInvites.length > 0 && (
        <p className="text-[11px] text-sp-textSecondary">
          {inactiveInvites.length} expired / used / revoked invite
          {inactiveInvites.length === 1 ? "" : "s"} hidden.
        </p>
      )}

      <p className="text-[11px] text-sp-textSecondary">
        Carrier removes a driver → that driver immediately loses sponsored
        access. If they have no personal Basic Driver subscription they fall
        back to the Free tier.
      </p>
    </section>
  );
}
