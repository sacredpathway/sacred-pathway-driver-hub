"use client";

import { useFormStatus } from "react-dom";

/**
 * Confirm-then-submit button for hard-deleting a load. Hooked to a parent
 * <form action={deleteLoadAction.bind(...)}>. Server action refuses if any
 * paystub references the load, regardless of confirmation here.
 */
export default function DeleteLoadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!pending && !window.confirm(
          "Delete this load? This is permanent. " +
          "If the load is on any paystub, the deletion will be refused."
        )) e.preventDefault();
      }}
      className="rounded-md border border-sp-danger/40 px-3 py-1.5 text-xs font-medium text-sp-danger hover:bg-sp-danger/10 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete load"}
    </button>
  );
}
