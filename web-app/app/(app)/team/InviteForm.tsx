// =============================================================================
//  InviteForm — Carrier-Sponsored Driver Access
// -----------------------------------------------------------------------------
//  Client form to create a new driver invite. Single endpoint creates either
//  an email-targeted invite (use=1) OR an open shareable code (use=10 by
//  default). Display the resulting code immediately so the carrier can copy
//  it without reloading the page.
// =============================================================================

"use client";

import { useActionState, useState } from "react";
import { createInviteAction, type TeamActionState } from "./actions";

export default function InviteForm() {
  const [state, formAction, pending] = useActionState<
    TeamActionState | undefined,
    FormData
  >(createInviteAction, undefined);
  const [emailMode, setEmailMode] = useState<"email" | "open">("open");

  return (
    <form action={formAction} className="rounded-xl border border-white/5 bg-sp-card p-5">
      <header className="mb-3 space-y-1">
        <h2 className="text-base font-semibold text-sp-textPrimary">Invite a driver</h2>
        <p className="text-xs text-sp-textSecondary">
          Pick a delivery method. Sponsored drivers get Basic Driver access
          included with your Carrier subscription.
        </p>
      </header>

      <div className="mb-3 flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setEmailMode("open")}
          className={
            "rounded-md px-3 py-1.5 font-medium " +
            (emailMode === "open"
              ? "bg-sp-gold text-sp-black"
              : "border border-white/10 text-sp-textSecondary hover:bg-white/5")
          }
        >
          Shareable code / link
        </button>
        <button
          type="button"
          onClick={() => setEmailMode("email")}
          className={
            "rounded-md px-3 py-1.5 font-medium " +
            (emailMode === "email"
              ? "bg-sp-gold text-sp-black"
              : "border border-white/10 text-sp-textSecondary hover:bg-white/5")
          }
        >
          Email-specific invite
        </button>
      </div>

      {state && !state.ok && (
        <div className="mb-3 rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-sp-danger">
          {state.error}
        </div>
      )}
      {state && state.ok && state.invite_code && (
        <div className="mb-3 rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-3 text-sm text-sp-success">
          <div className="text-xs uppercase tracking-wide opacity-70">Invite code</div>
          <div className="mt-1 font-mono text-base text-sp-gold">{state.invite_code}</div>
          <div className="mt-2 text-[11px] text-sp-textSecondary">
            Share the code OR the link:{" "}
            <code className="rounded bg-sp-cardLight px-1.5 py-0.5">/join/{state.invite_code}</code>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {emailMode === "email" && (
          <label className="block space-y-1 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
              Driver email
            </span>
            <input
              type="email"
              name="email"
              required
              placeholder="driver@example.com"
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            />
          </label>
        )}
        {emailMode === "open" && (
          <label className="block space-y-1 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
              Max uses
            </span>
            <input
              type="number"
              name="max_uses"
              defaultValue={10}
              min={1}
              max={1000}
              className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Expires (days)
          </span>
          <input
            type="number"
            name="expires_days"
            defaultValue={30}
            min={1}
            max={365}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create invite"}
        </button>
      </div>
    </form>
  );
}
