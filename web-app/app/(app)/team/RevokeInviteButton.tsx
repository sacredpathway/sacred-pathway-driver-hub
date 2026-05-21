"use client";

import { useFormStatus } from "react-dom";
import { revokeInviteAction } from "./actions";

export default function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const action = revokeInviteAction.bind(null, inviteId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Revoke this invite? The code stops working immediately.")) {
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
      className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-sp-textSecondary hover:bg-white/5 disabled:opacity-50"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
