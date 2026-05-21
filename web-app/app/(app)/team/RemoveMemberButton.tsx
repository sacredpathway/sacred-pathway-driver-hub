"use client";

import { useFormStatus } from "react-dom";
import { removeMemberAction } from "./actions";

export default function RemoveMemberButton({ memberId }: { memberId: string }) {
  const action = removeMemberAction.bind(null, memberId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Remove this driver? They lose sponsored access immediately. (Their data stays intact and you can re-invite them.)")) {
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
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
