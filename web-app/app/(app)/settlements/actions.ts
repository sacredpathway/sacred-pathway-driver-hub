// =============================================================================
//  Settlement server actions — Carrier HQ Phase W7
// -----------------------------------------------------------------------------
//  Right now there's only one action: convertLegacySettlementToPaystubAction.
//  It seeds a draft `paystubs` row from a legacy iOS-created `settlements`
//  row, then links the two via settlements.paystub_id (already a nullable FK
//  added in 20260521020000_settlements_link_paystub.sql, no schema change).
//
//  Safety rails:
//    • Refuses if the settlement already has paystub_id set (would create
//      dup).
//    • Refuses if the settlement has no driver_id (paystubs.driver_id is
//      NOT NULL / ON DELETE RESTRICT — the carrier must edit the iOS
//      settlement first).
//    • Refuses if the legacy row's pay_period dates are missing (paystubs
//      requires both).
//    • Worker type defaults to '1099' — every legacy iOS settlement was
//      created before the W2 split shipped on web.
//    • Inserts paystub status='draft' so the carrier can add deductions /
//      issue from /payroll/<id> without committing financials immediately.
// =============================================================================

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity/log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function convertLegacySettlementToPaystubAction(
  settlementId: string
): Promise<void> {
  if (!settlementId || !UUID_RE.test(settlementId)) {
    throw new Error("Missing or invalid settlement id.");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // 1. Load the settlement + RLS confirms ownership (cross-user → no row)
  const { data: settlement, error: sErr } = await supabase
    .from("settlements")
    .select("*")
    .eq("id", settlementId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!settlement) throw new Error("Settlement not found.");

  // 2. Guards
  if (settlement.paystub_id) {
    throw new Error(
      "This settlement is already linked to a paystub. Open it from Payroll."
    );
  }
  if (!settlement.driver_id) {
    throw new Error(
      "This settlement isn't assigned to a driver. Assign one in the iPhone app first, then try again."
    );
  }
  if (!settlement.settlement_period_start || !settlement.settlement_period_end) {
    throw new Error(
      "This settlement is missing pay-period dates. Fill them in on the iPhone app first."
    );
  }

  const gross   = Number(settlement.total_revenue ?? 0);
  const netPay  = Number(settlement.driver_pay_amount ?? settlement.net_pay ?? 0);

  // 3. Create the paystub draft
  const { data: paystub, error: pErr } = await supabase
    .from("paystubs")
    .insert({
      profile_id:       user.id,
      driver_id:        settlement.driver_id,
      worker_type:      "1099",
      pay_period_start: settlement.settlement_period_start,
      pay_period_end:   settlement.settlement_period_end,
      check_date:       null,
      status:           "draft",
      payment_method:   null,
      gross_earnings:   gross,
      total_pretax_deductions:    0,
      taxable_wages:              null,
      total_taxes_withheld:       0,
      total_posttax_deductions:   0,
      total_reimbursements:       0,
      total_settlement_deductions: Math.max(0, gross - netPay),
      net_pay:          netPay,
      notes:            "Converted from legacy iOS settlement " + settlementId,
      created_by_user_id: user.id,
    })
    .select("id")
    .single();
  if (pErr) throw new Error(pErr.message);

  // 4. Link the legacy row to the paystub. The v_payroll_unified view filters
  //    out legacy rows with paystub_id set, so the settlement instantly drops
  //    out of the /settlements list once this completes.
  const { error: linkErr } = await supabase
    .from("settlements")
    .update({ paystub_id: paystub.id })
    .eq("id", settlementId)
    .eq("profile_id", user.id);
  if (linkErr) {
    // Best-effort rollback: delete the orphan paystub we just created.
    await supabase.from("paystubs").delete().eq("id", paystub.id).eq("profile_id", user.id);
    throw new Error(linkErr.message);
  }

  await logActivity(supabase, user.id, {
    entityType: "settlement",
    entityId: settlementId,
    action: "converted",
    metadata: {
      label: `Legacy settlement converted to draft paystub`,
      paystub_id: paystub.id,
      amount: netPay,
    },
  });

  revalidatePath("/settlements");
  revalidatePath("/payroll");
  revalidatePath(`/payroll/${paystub.id}`);
  // Land the carrier on the new paystub so they can add line items.
  redirect(`/payroll/${paystub.id}?converted=1`);
}
