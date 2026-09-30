// =============================================================================
//  Money — exact-decimal currency value for the web app
// -----------------------------------------------------------------------------
//  Web twin of iOS `SacredPathway/Models/Money.swift`. Every rule below is
//  deliberately identical so the same inputs produce the same cents on both
//  clients (Phase D shares test fixtures between the two):
//
//   - Backed by decimal.js, NEVER a JS float. 0.1 + 0.2 is exactly 0.30.
//   - Intermediate math keeps full precision; rounding happens only at an
//     accounting boundary (one printed line, one stored column, one total).
//   - Rounding is half AWAY from zero (Swift `.plain` / decimal.js
//     ROUND_HALF_UP). $1,234.565 -> $1,234.57, -$0.005 -> -$0.01.
//   - A JS number coming out of Supabase `numeric` is routed through a
//     6-decimal fixed string, exactly like Swift `Money(double:)`.
//   - Division by zero yields $0.00 (Swift parity), never Infinity/NaN.
//
//  Uses a private Decimal clone so nothing else in the bundle can change the
//  precision or rounding mode out from under us.
// =============================================================================

import DecimalBase from "decimal.js";

export const D = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Dec = InstanceType<typeof D>;

/** Anything a Money operation will accept as a scalar (rate, miles, percent). */
export type DecimalInput = Dec | string | number;

function toDec(v: DecimalInput): Dec {
  if (v instanceof D) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return new D(0);
    // Same boundary rule as Swift Money(double:): 6 fixed decimals.
    return new D(v.toFixed(6));
  }
  return new D(v);
}

export class Money {
  /** Exact, unrounded value. Never mutated. */
  readonly amount: Dec;

  private constructor(amount: Dec) {
    // Normalise -0 so equality and formatting never see a negative zero.
    this.amount = amount.isZero() ? new D(0) : amount;
  }

  // MARK: construction ------------------------------------------------------

  static readonly zero = new Money(new D(0));

  /** From an exact decimal string or Decimal. Throws on garbage. */
  static of(value: Dec | string): Money {
    return new Money(value instanceof D ? value : new D(value));
  }

  /** From a whole number of cents — safest literal form for tests. */
  static fromCents(cents: number | bigint): Money {
    if (typeof cents === "number" && !Number.isInteger(cents)) {
      throw new RangeError(`fromCents expects an integer, got ${cents}`);
    }
    return new Money(new D(cents.toString()).div(100));
  }

  /**
   * From a JS number (Supabase `numeric`, legacy code). Non-finite -> $0.00.
   * null/undefined -> $0.00 (every money column in the schema is nullable).
   */
  static fromNumber(value: number | null | undefined): Money {
    if (value === null || value === undefined) return Money.zero;
    return new Money(toDec(value));
  }

  /**
   * Parse user input. "$1,234.56", "1234.56", "(50.00)" -> -50.00,
   * "-$5" -> -5.00. Returns null for empty or unparseable input.
   */
  static parse(input: string | null | undefined): Money | null {
    if (input === null || input === undefined) return null;
    let s = input.trim();
    if (!s) return null;
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      negative = true;
      s = s.slice(1, -1);
    }
    s = s.replace(/[$,\s]/g, "");
    if (s.startsWith("-")) {
      negative = true; // Swift parity: "(-5)" is still -5, not +5
      s = s.slice(1);
    }
    if (!s || !/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const d = new D(s);
    return new Money(negative ? d.neg() : d);
  }

  // MARK: rounding ----------------------------------------------------------

  /** Rounded to cents, half away from zero. Idempotent. */
  rounded(): Money {
    return new Money(this.amount.toDecimalPlaces(2, D.ROUND_HALF_UP));
  }

  /** Rounded to an arbitrary scale — per-mile figures (3dp), ratios. */
  roundedTo(scale: number): Money {
    return new Money(this.amount.toDecimalPlaces(scale, D.ROUND_HALF_UP));
  }

  /** Whole cents of the rounded value, as a bigint (never overflows). */
  cents(): bigint {
    return BigInt(this.amount.mul(100).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0));
  }

  /**
   * Boundary conversion for a Supabase `numeric(14,2)` column or legacy
   * number API. Always rounds first so a column never carries float noise.
   */
  toNumber(): number {
    return Number(this.rounded().amount.toFixed(2));
  }

  /** "1234.56" — exact, rounded, 2dp. Preferred wire format for writes. */
  toFixed2(): string {
    return this.rounded().amount.toFixed(2);
  }

  // MARK: sign --------------------------------------------------------------

  isZero(): boolean { return this.amount.isZero(); }
  isNegative(): boolean { return this.amount.isNegative() && !this.amount.isZero(); }
  isPositive(): boolean { return this.amount.isPositive() && !this.amount.isZero(); }
  abs(): Money { return new Money(this.amount.abs()); }
  negated(): Money { return new Money(this.amount.neg()); }

  /** Negative becomes $0.00. */
  clampedToZero(): Money { return this.isNegative() ? Money.zero : this; }

  /** Never more than `ceiling`, never less than zero (Swift `capped(at:)`). */
  cappedAt(ceiling: Money): Money {
    if (!ceiling.isPositive()) return Money.zero;
    return this.amount.gt(ceiling.amount) ? ceiling : this.clampedToZero();
  }

  // MARK: arithmetic --------------------------------------------------------

  plus(o: Money): Money { return new Money(this.amount.plus(o.amount)); }
  minus(o: Money): Money { return new Money(this.amount.minus(o.amount)); }
  times(factor: DecimalInput): Money { return new Money(this.amount.mul(toDec(factor))); }
  dividedBy(divisor: DecimalInput): Money {
    const d = toDec(divisor);
    if (d.isZero()) return Money.zero;
    return new Money(this.amount.div(d));
  }

  /** `percent` as a carrier says it: 70 means 70%. Full precision kept. */
  percentage(percent: DecimalInput): Money {
    return new Money(this.amount.mul(toDec(percent)).div(100));
  }

  static sum(values: ReadonlyArray<Money>): Money {
    return values.reduce((acc, v) => acc.plus(v), Money.zero);
  }

  // MARK: comparison --------------------------------------------------------

  equals(o: Money): boolean { return this.amount.eq(o.amount); }
  lt(o: Money): boolean { return this.amount.lt(o.amount); }
  lte(o: Money): boolean { return this.amount.lte(o.amount); }
  gt(o: Money): boolean { return this.amount.gt(o.amount); }
  gte(o: Money): boolean { return this.amount.gte(o.amount); }
  static compare(a: Money, b: Money): number { return a.amount.cmp(b.amount); }

  // MARK: formatting --------------------------------------------------------

  /** "$1,234.56" / "-$1,234.56". en-US, fixed, no float round-trip. */
  format(): string {
    const r = this.rounded();
    const [whole, frac] = r.amount.abs().toFixed(2).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${r.isNegative() ? "-" : ""}$${grouped}.${frac}`;
  }

  /** "-$1,180.00" for a deduction line, "+$250.00" for a credit line. */
  formatSigned(asCredit: boolean): string {
    const base = this.abs().format();
    if (this.rounded().isZero()) return base;
    return (asCredit ? "+" : "-") + base;
  }

  toString(): string { return this.format(); }

  /** JSON as the rounded 2dp string — never a lossy float. */
  toJSON(): string { return this.toFixed2(); }
}

// MARK: helpers used by pay rules ------------------------------------------

/** miles × rate-per-mile, full precision (caller rounds at the line). */
export function mileagePay(miles: DecimalInput, ratePerMile: DecimalInput): Money {
  return Money.of(toDec(ratePerMile)).times(miles);
}

/** Parse a user-entered percentage/rate: "70", "12.5%", "1,000". */
export function parseRate(input: string | null | undefined): Dec | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().replace(/[%,\s]/g, "");
  if (!s || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return new D(s);
}
