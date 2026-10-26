// =============================================================================
//  Statement text formatters — byte-for-byte twins of the iPhone formatters
// -----------------------------------------------------------------------------
//  The pay-basis text ("70% of $5,000.00", "1,200 mi × $0.585") is FROZEN onto
//  settlement_loads.pay_basis_description and printed on the driver's
//  statement, so web and iPhone must produce the same characters.
//  All en_US, fixed locale, half-away-from-zero rounding.
// =============================================================================

import { D, Money, type Dec } from "@/lib/money/money";

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** NumberFormatter(.decimal, min 0 / max `maxFrac` fraction digits), en_US. */
export function decimalString(value: Dec, maxFrac: number): string {
  const r = value.toDecimalPlaces(maxFrac, D.ROUND_HALF_UP);
  const neg = r.isNegative() && !r.isZero();
  const fixed = r.abs().toFixed(maxFrac);
  let [whole, frac = ""] = fixed.split(".");
  frac = frac.replace(/0+$/, "");
  whole = group(whole);
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

/** Swift `Decimal.asPercentString`: "70%", "12.5%", "33.33%". */
export function percentString(value: Dec): string {
  return decimalString(value, 2) + "%";
}

/** iPhone engine formatMiles: 1 decimal max. */
export function milesString(value: Dec): string {
  return decimalString(value, 1);
}

/** iPhone engine formatHours: 2 decimals max. */
export function hoursString(value: Dec): string {
  return decimalString(value, 2);
}

/** Swift `Money.formatted` — "$1,234.56" / "-$1,234.56". */
export function moneyString(m: Money): string {
  return m.format();
}
