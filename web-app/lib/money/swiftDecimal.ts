// =============================================================================
//  swiftDecimalFromDouble — exact port of Foundation `Decimal(_ value: Double)`
// -----------------------------------------------------------------------------
//  The iPhone builds ONE settlement value this way: the legacy fallback rule
//  `.percentOfGross(Decimal(pct))` (Settlement.swift effectivePayRule), used
//  when a settlement has no stored pay_rule but has driver_pay_percentage.
//  Foundation does NOT convert the double's shortest form ("33.33"); it scales
//  the binary value by 10 with double multiplications until it reaches
//  UInt64.max, then truncates to a UInt64 mantissa:
//
//      Decimal(33.33)  = 33.32999999999999488
//      Decimal(76.84)  = 76.84000000000002048   (Apple-reported, SR-11514)
//      Decimal(456.789)= 456.7889999999998976   (SR-8409)
//      Decimal(3.133)  = 3.132999999999999488
//
//  On an exact half cent (33.33% of $50.00 = $16.665) the iPhone therefore
//  pays $16.66, not $16.67. To keep the approved iPhone calculation exact, the
//  web reproduces the same digits. JS numbers are the same IEEE-754 doubles,
//  so the same multiplications give the same bits.
// =============================================================================

const U64_MAX_MINUS_1 = 18446744073709551614; // Double(UInt64.max - 1) → 1.8446744073709552e19

export function swiftDecimalFromDouble(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const negative = value < 0;
  let val = negative ? -value : value;
  let exponent = 0;
  while (val < U64_MAX_MINUS_1) { val *= 10.0; exponent -= 1; }
  while (U64_MAX_MINUS_1 < val) { val /= 10.0; exponent += 1; }
  // UInt64(val): val is an integer-valued double here (magnitude ≥ 2^53).
  let digits = BigInt(Math.trunc(val)).toString();
  // Apply the base-10 exponent.
  let out: string;
  if (exponent >= 0) {
    out = digits + "0".repeat(exponent);
  } else {
    const k = -exponent;
    if (digits.length <= k) digits = "0".repeat(k - digits.length + 1) + digits;
    const intPart = digits.slice(0, digits.length - k);
    const frac = digits.slice(digits.length - k).replace(/0+$/, "");
    out = frac ? `${intPart}.${frac}` : intPart;
  }
  out = out.replace(/^0+(?=\d)/, "");
  return negative ? "-" + out : out;
}
