// =============================================================================
//  ConvertButton — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Confirm + submit wrapper for convertLegacySettlementToPaystubAction.
//  Wired through useFormStatus so the button label flips during the request.
// =============================================================================

"use client";

import { useFormStatus } from "react-dom";
import { convertLegacySettlementToPaystubAction } from "../actions";

export default function ConvertButton({ settlementId }: { settlementId: string }) {
  const action = convertLegacySettlementToPaystubAction.bind(null, settlementId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(
          "Create a draft paystub from this settlement? The legacy row will " +
          "link to the new paystub and won't appear in Settlements anymore. " +
          "Nothing about the legacy row is deleted."
        )) {
          e.preventDefault();
        }
      }}
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
      className="rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight disabled:opacity-50"
    >
      {pending ? "Converting…" : "Convert to paystub"}
    </button>
  );
}
