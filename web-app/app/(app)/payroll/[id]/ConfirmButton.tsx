"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that requires confirmation before posting the parent
 * `<form action={…}>`. Used for one-way actions like Issue / Void.
 *
 * Lives outside ./PaystubEditor.tsx so the editor can stay a Server
 * Component (cheap, no client bundle for the table) while still letting us
 * gate destructive transitions.
 */
export default function ConfirmButton({
  label,
  pendingLabel,
  confirmText,
  variant = "primary",
}: {
  label: string;
  pendingLabel?: string;
  confirmText: string;
  variant?: "primary" | "danger" | "success";
}) {
  const cls =
    variant === "danger"
      ? "border border-sp-danger/40 text-sp-danger hover:bg-sp-danger/10"
      : variant === "success"
      ? "bg-sp-success/80 text-sp-black hover:bg-sp-success"
      : "bg-sp-gold text-sp-black hover:bg-sp-goldLight";

  return (
    <SubmitInner
      cls={cls}
      label={label}
      pendingLabel={pendingLabel ?? "Working…"}
      confirmText={confirmText}
    />
  );
}

function SubmitInner({
  cls,
  label,
  pendingLabel,
  confirmText,
}: {
  cls: string;
  label: string;
  pendingLabel: string;
  confirmText: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!pending && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${cls}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
