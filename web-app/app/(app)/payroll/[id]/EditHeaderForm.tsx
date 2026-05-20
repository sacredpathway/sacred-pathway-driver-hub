// =============================================================================
//  EditHeaderForm — draft-only paystub header editor
// -----------------------------------------------------------------------------
//  Phase W3 step 1. Renders as a collapsed card on /payroll/[id] for draft
//  paystubs only. Three fields:
//    • payment_method  (select; enum)
//    • check_number    (text; trimmed server-side)
//    • notes           (textarea; trimmed; internal-only, not on the paystub)
//
//  The parent server component decides whether to render this at all —
//  if status !== 'draft' the component is never mounted. Belt-and-suspenders
//  the server action also rejects non-draft writes.
// =============================================================================

"use client";

import { useActionState, useEffect, useState } from "react";
import type { PaymentMethod, Paystub } from "@/lib/supabase/types";
import type { PaystubActionState } from "../actions";

type ServerAction = (
  prev: PaystubActionState | undefined,
  formData: FormData
) => Promise<PaystubActionState>;

const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod | ""; label: string }> = [
  { value: "",               label: "— Not set —" },
  { value: "ach",            label: "ACH" },
  { value: "zelle",          label: "Zelle" },
  { value: "cash",           label: "Cash" },
  { value: "check",          label: "Check" },
  { value: "direct_deposit", label: "Direct deposit" },
  { value: "other",          label: "Other" },
];

export default function EditHeaderForm({
  paystub,
  action,
}: {
  paystub: Paystub;
  action: ServerAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    PaystubActionState | undefined,
    FormData
  >(action, undefined);

  // Auto-close on a successful save so the carrier sees their values reflected
  // in the read-only summary line above. Effect, not render, to avoid a
  // setState-during-render warning.
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  const summary = formatSummary(paystub);

  return (
    <section className="rounded-xl border border-white/5 bg-sp-card/40 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-sp-textPrimary">Header details</h2>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Set how the driver gets paid and any internal notes. These three
            fields can be edited any time the paystub is in draft.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5"
        >
          {open ? "Cancel" : "Edit header"}
        </button>
      </header>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <Read label="Payment method" value={summary.paymentMethodLabel} />
        <Read label="Check #" value={summary.checkNumber} />
        <Read label="Notes" value={summary.notes} wide />
      </dl>

      {open && (
        <form action={formAction} className="mt-4 space-y-3">
          {state && !state.ok && (
            <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger">
              {state.error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
                Payment method
              </span>
              <select
                name="payment_method"
                defaultValue={paystub.payment_method ?? ""}
                className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary focus:border-sp-gold focus:outline-none"
              >
                {PAYMENT_METHOD_OPTIONS.map((o) => (
                  <option key={o.value || "none"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
                Check #
              </span>
              <input
                type="text"
                name="check_number"
                defaultValue={paystub.check_number ?? ""}
                placeholder="e.g. 10428"
                maxLength={64}
                className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
              />
              <span className="mt-1 block text-[10px] text-sp-textSecondary">
                Only used when payment method is Check.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-sp-textSecondary">
              Internal notes
            </span>
            <textarea
              name="notes"
              rows={3}
              defaultValue={paystub.notes ?? ""}
              placeholder="Won't appear on the printed paystub. Use this for your own bookkeeping."
              className="mt-1 w-full rounded-md border border-white/10 bg-sp-background px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary/60 focus:border-sp-gold focus:outline-none"
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textSecondary hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save header"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Read({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-3" : undefined}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-sp-textPrimary">{value}</dd>
    </div>
  );
}

function formatSummary(p: Paystub): {
  paymentMethodLabel: string;
  checkNumber: string;
  notes: string;
} {
  const pmOpt = PAYMENT_METHOD_OPTIONS.find((o) => o.value === (p.payment_method ?? ""));
  return {
    paymentMethodLabel: pmOpt?.label ?? "— Not set —",
    checkNumber: p.check_number ?? "—",
    notes: p.notes ?? "—",
  };
}
