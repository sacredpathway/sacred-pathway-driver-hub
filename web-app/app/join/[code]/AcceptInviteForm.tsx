"use client";

import { useActionState } from "react";
import { acceptInviteAction, type JoinActionState } from "./actions";

export default function AcceptInviteForm({ code }: { code: string }) {
  const bound = acceptInviteAction.bind(null, code);
  const [state, formAction, pending] = useActionState<
    JoinActionState | undefined,
    FormData
  >(bound, undefined);

  return (
    <form action={formAction} className="space-y-3">
      {state && !state.ok && (
        <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-sp-danger">
          {state.error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-sp-gold px-6 py-3 font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
      >
        {pending ? "Accepting…" : "Accept invite"}
      </button>
    </form>
  );
}
