// =============================================================================
//  InviteDriverForm — full driver-info onboarding (Carrier HQ)
// -----------------------------------------------------------------------------
//  Carrier admin enters: name, email, phone, worker_type (1099|W2),
//  pay_type (percent | rate per mile), pay_value, optional notes.
//
//  On submit (inviteDriverAction):
//    • drivers roster row is created (or reused if email matches)
//    • carrier_invites row is created tied to that driver + email
//    • invite email is sent via Resend if env vars are configured
//
//  Success banner shows: invite code + copy-link button + email status
//  ("Email sent to <addr>" or "Email NOT sent — copy this link and message
//   it to the driver" if email provider is not configured).
// =============================================================================

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { inviteDriverAction, type InviteDriverActionState } from "./actions";

export default function InviteDriverForm() {
  const [state, formAction, pending] = useActionState<
    InviteDriverActionState | undefined,
    FormData
  >(inviteDriverAction, undefined);

  const [payTypeUI, setPayTypeUI] = useState<"percent" | "mileage">("percent");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastClearedCode = useRef<string | null>(null);

  // After a successful submit, clear the inputs so the carrier can invite
  // the next driver without leftover values. Tracked via a ref so React
  // strict-mode double-invokes don't re-clear after the carrier starts
  // typing the next invite.
  useEffect(() => {
    if (
      state?.ok &&
      formRef.current &&
      lastClearedCode.current !== state.invite_code
    ) {
      formRef.current.reset();
      lastClearedCode.current = state.invite_code;
      setPayTypeUI("percent");
    }
  }, [state]);

  async function copy(text: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked — user can still select+copy from the banner */
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-xl border border-white/5 bg-sp-card p-5"
    >
      <header className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-sp-textPrimary">
          Invite a driver
        </h2>
        <p className="text-xs text-sp-textSecondary">
          Enter the driver&apos;s info — we&apos;ll add them to your roster and
          email them a join link. Sponsored drivers get Basic Driver access
          included with your Carrier subscription.
        </p>
      </header>

      {/* error */}
      {state && !state.ok && (
        <div className="mb-3 rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-sp-danger">
          {state.error}
          {state.field ? <span className="ml-1 opacity-70">({state.field})</span> : null}
        </div>
      )}

      {/* success */}
      {state?.ok && (
        <div className="mb-4 space-y-3 rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-3 text-sm text-sp-success">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide opacity-70">
                Invite code
              </div>
              <div className="mt-0.5 font-mono text-base text-sp-gold">
                {state.invite_code}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(state.invite_code, "code")}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-sp-textPrimary hover:bg-white/5"
              >
                {copied === "code" ? "Copied!" : "Copy code"}
              </button>
              <button
                type="button"
                onClick={() => copy(state.invite_url, "link")}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-sp-textPrimary hover:bg-white/5"
              >
                {copied === "link" ? "Copied!" : "Copy link"}
              </button>
            </div>
          </div>

          <div className="text-[11px] text-sp-textSecondary">
            Link:{" "}
            <code className="break-all rounded bg-sp-cardLight px-1.5 py-0.5">
              {state.invite_url}
            </code>
          </div>

          <div className="text-[11px]">
            {state.email_sent ? (
              <span className="text-sp-success">
                ✓ Email sent — driver will receive the invite shortly.
              </span>
            ) : (
              <span className="text-sp-warning">
                ⚠ Email NOT sent ({state.email_reason}). Copy the link above
                and message it to the driver directly (text, AirDrop, etc.).
              </span>
            )}
          </div>

          {(state.reused_driver || state.reused_invite) && (
            <div className="text-[11px] text-sp-textSecondary">
              {state.reused_driver && state.reused_invite
                ? "Updated existing driver row + reused open invite (no duplicates created)."
                : state.reused_driver
                ? "Updated existing driver row (no duplicate row created)."
                : "Reused existing open invite for this email (no duplicate code created)."}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Driver name <span className="text-sp-danger">*</span>
          </span>
          <input
            type="text"
            name="name"
            required
            autoComplete="off"
            placeholder="e.g. John Smith"
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Driver email <span className="text-sp-danger">*</span>
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            placeholder="driver@example.com"
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Phone <span className="text-sp-textSecondary opacity-60">(optional)</span>
          </span>
          <input
            type="tel"
            name="phone"
            autoComplete="off"
            placeholder="(555) 555-5555"
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Worker type <span className="text-sp-danger">*</span>
          </span>
          <select
            name="worker_type"
            defaultValue="1099"
            required
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="1099">1099 — Contractor / Owner-operator</option>
            <option value="W2">W2 — Employee</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Pay type <span className="text-sp-danger">*</span>
          </span>
          <select
            name="pay_type"
            value={payTypeUI}
            onChange={(e) =>
              setPayTypeUI((e.target.value as "percent" | "mileage") ?? "percent")
            }
            required
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="percent">Percent of revenue</option>
            <option value="mileage">Rate per mile</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            {payTypeUI === "percent"
              ? "Percent (0–100)"
              : "Rate per mile ($)"}{" "}
            <span className="text-sp-textSecondary opacity-60">(optional)</span>
          </span>
          <input
            type="text"
            name="pay_value"
            inputMode="decimal"
            autoComplete="off"
            placeholder={payTypeUI === "percent" ? "e.g. 25" : "e.g. 0.65"}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1 md:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Notes <span className="text-sp-textSecondary opacity-60">(optional)</span>
          </span>
          <textarea
            name="notes"
            rows={2}
            placeholder="Internal notes about this invite — visible to you only."
            className="w-full resize-y rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-sp-textSecondary">
          Driver is single-use, expires in 30 days. Reusing the same email
          updates the existing row instead of creating a duplicate.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-sp-gold px-4 py-2 text-xs font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Add driver & send invite"}
        </button>
      </div>
    </form>
  );
}
