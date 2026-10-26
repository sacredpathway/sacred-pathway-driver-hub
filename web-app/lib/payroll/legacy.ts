// =============================================================================
//  Legacy web paystubs — READ-ONLY (owner decision, 2026-10)
// -----------------------------------------------------------------------------
//  The iPhone settlement model is the single live payroll system on web and
//  iOS. Existing web paystubs stay as read-only history: they are not deleted,
//  migrated or modified. Every paystub write action calls the guard below
//  first, so no form post (old tab, bookmark, script) can change one.
//
//  To re-enable paystub writes (owner approval required), flip this constant.
// =============================================================================

export const LEGACY_PAYSTUBS_READ_ONLY = true;

export const LEGACY_PAYSTUB_MESSAGE =
  "Web paystubs are read-only history now. Pay drivers through Settlements — the same settlements the iPhone app uses.";

export function assertLegacyPaystubWritesAllowed(): void {
  if (LEGACY_PAYSTUBS_READ_ONLY) throw new Error(LEGACY_PAYSTUB_MESSAGE);
}
