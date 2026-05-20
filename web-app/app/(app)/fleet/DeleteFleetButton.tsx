"use client";

import { useFormStatus } from "react-dom";

/**
 * Confirm-then-submit button for hard-deleting a truck or trailer. Hooked to a
 * parent <form action={deleteTruckAction.bind(...)}> or trailer equivalent.
 * Server refuses if any load references the unit — archive (status='sold' or
 * 'inactive') is the preferred path for retired equipment.
 */
export default function DeleteFleetButton({
  kind,
}: {
  kind: "truck" | "trailer";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!pending && !window.confirm(
          `Delete this ${kind}? This is permanent. ` +
          "If any historical load references it, the deletion will be refused " +
          `(archive by setting Status to 'Sold' or 'Inactive' instead).`
        )) e.preventDefault();
      }}
      className="rounded-md border border-sp-danger/40 px-3 py-1.5 text-xs font-medium text-sp-danger hover:bg-sp-danger/10 disabled:opacity-50"
    >
      {pending ? "Deleting…" : `Delete ${kind}`}
    </button>
  );
}
