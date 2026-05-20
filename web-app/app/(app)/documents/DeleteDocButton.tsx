// =============================================================================
//  DeleteDocButton — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Small client-side wrapper around deleteDocumentAction. confirm() blocks
//  the click before the form submits; the server action returns void and
//  redirects on success.
// =============================================================================

"use client";

import { useFormStatus } from "react-dom";
import { deleteDocumentAction } from "./actions";

export default function DeleteDocButton({ documentId }: { documentId: string }) {
  const action = deleteDocumentAction.bind(null, documentId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this document? The file is removed from storage too.")) {
          e.preventDefault();
        }
      }}
      className="inline"
    >
      <SubmitBtn />
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-2 py-1 text-[10px] font-semibold text-sp-danger hover:bg-sp-danger/20 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
