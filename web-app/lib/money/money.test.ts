import { describe, expect, it } from "vitest";
import { Money, mileagePay, parseRate, D } from "./money";

const $ = (s: string) => Money.of(s);

describe("Money — construction & parsing", () => {
  it("parses currency strings like Swift Money(input:)", () => {
    expect(Money.parse("$1,234.56")!.toFixed2()).toBe("1234.56");
    expect(Money.parse("1234.56")!.toFixed2()).toBe("1234.56");
    expect(Money.parse("(50.00)")!.toFixed2()).toBe("-50.00");
    expect(Money.parse("-$5")!.toFixed2()).toBe("-5.00");
    expect(Money.parse("(-5)")!.toFixed2()).toBe("-5.00");
    expect(Money.parse("  .5 ")!.toFixed2()).toBe("0.50");
    expect(Money.parse("0")!.isZero()).toBe(true);
  });

  it("rejects empty and garbage input", () => {
    for (const bad of ["", "   ", "abc", "1.2.3", "$", "--5", "5-", "1e5", null, undefined]) {
      expect(Money.parse(bad as string | null | undefined)).toBeNull();
    }
  });

  it("fromCents is exact and rejects fractional cents", () => {
    expect(Money.fromCents(123456).toFixed2()).toBe("1234.56");
    expect(Money.fromCents(-1).toFixed2()).toBe("-0.01");
    expect(Money.fromCents(10n ** 15n).toFixed2()).toBe("10000000000000.00");
    expect(() => Money.fromCents(1.5)).toThrow(RangeError);
  });

  it("fromNumber routes floats through 6 fixed decimals (Swift Money(double:))", () => {
    expect(Money.fromNumber(1234.5699999999999).toFixed2()).toBe("1234.57");
    expect(Money.fromNumber(0.1).plus(Money.fromNumber(0.2)).equals($("0.3"))).toBe(true);
    expect(Money.fromNumber(null).isZero()).toBe(true);
    expect(Money.fromNumber(undefined).isZero()).toBe(true);
    expect(Money.fromNumber(Number.NaN).isZero()).toBe(true);
    expect(Money.fromNumber(Number.POSITIVE_INFINITY).isZero()).toBe(true);
  });
});

describe("Money — arithmetic", () => {
  it("adds and subtracts exactly (no float drift)", () => {
    let total = Money.zero;
    for (let i = 0; i < 1000; i++) total = total.plus($("0.10"));
    expect(total.toFixed2()).toBe("100.00");
    expect($("0.3").minus($("0.1")).equals($("0.2"))).toBe(true);
  });

  it("multiplies and divides; divide by zero is $0.00", () => {
    expect($("19.99").times(3).toFixed2()).toBe("59.97");
    expect($("100").dividedBy(3).toFixed2()).toBe("33.33");
    expect($("100").dividedBy(0).isZero()).toBe(true);
    expect($("100").dividedBy("0.00").isZero()).toBe(true);
  });

  it("percentages keep full precision until rounded", () => {
    expect($("7250.00").percentage(70).toFixed2()).toBe("5075.00");
    expect($("1000").percentage("12.5").toFixed2()).toBe("125.00");
    // 2.5% factoring of 1,234.50 = 30.8625 -> 30.86 only when rounded
    const fee = $("1234.50").percentage("2.5");
    expect(fee.amount.toString()).toBe("30.8625");
    expect(fee.rounded().toFixed2()).toBe("30.86");
    // percentage of a percentage is not rounded halfway
    expect($("1000.01").percentage(10).percentage(10).amount.toString()).toBe("10.0001");
  });

  it("mileage pay: miles × rate, rounded only at the line", () => {
    expect(mileagePay(512, "0.65").toFixed2()).toBe("332.80");
    expect(mileagePay("1234.5", "0.585").amount.toString()).toBe("722.1825");
    expect(mileagePay("1234.5", "0.585").rounded().toFixed2()).toBe("722.18");
    expect(mileagePay(0, "0.65").isZero()).toBe(true);
  });

  it("sums, including negative adjustments", () => {
    const lines = [$("1500.00"), $("-250.00"), $("75.25"), $("-0.25")];
    expect(Money.sum(lines).toFixed2()).toBe("1325.00");
    expect(Money.sum([]).isZero()).toBe(true);
  });

  it("handles large totals without precision loss", () => {
    const big = $("99999999999.99"); // numeric(14,2) max-ish
    expect(big.plus($("0.01")).toFixed2()).toBe("100000000000.00");
    expect(big.times(1000).toFixed2()).toBe("99999999999990.00");
    expect(big.cents()).toBe(9999999999999n);
  });
});

describe("Money — rounding (half away from zero, Swift .plain)", () => {
  it.each([
    ["1234.565", "1234.57"],
    ["1234.564", "1234.56"],
    ["0.005", "0.01"],
    ["-0.005", "-0.01"],
    ["-1234.565", "-1234.57"],
    ["2.675", "2.68"], // float would give 2.67
    ["1.005", "1.01"], // float would give 1.00
  ])("%s -> %s", (input, want) => {
    expect($(input).rounded().toFixed2()).toBe(want);
  });

  it("rounding is idempotent and roundedTo supports other scales", () => {
    const r = $("10.555").rounded();
    expect(r.rounded().equals(r)).toBe(true);
    expect($("0.58549").roundedTo(3).amount.toString()).toBe("0.585");
    expect($("0.5855").roundedTo(3).amount.toString()).toBe("0.586");
  });

  it("cents() and toNumber() use the rounded value", () => {
    expect($("12.345").cents()).toBe(1235n);
    expect($("-12.345").cents()).toBe(-1235n);
    expect($("12.345").toNumber()).toBe(12.35);
  });
});

describe("Money — sign helpers", () => {
  it("zero, negative zero and sign checks", () => {
    const negZero = $("-0.00");
    expect(negZero.isZero()).toBe(true);
    expect(negZero.isNegative()).toBe(false);
    expect(negZero.format()).toBe("$0.00");
    expect($("-0.001").rounded().format()).toBe("$0.00");
    expect($("-3").isNegative()).toBe(true);
    expect($("3").isPositive()).toBe(true);
  });

  it("clampedToZero and cappedAt match Swift", () => {
    expect($("-5").clampedToZero().isZero()).toBe(true);
    expect($("5").cappedAt($("3")).toFixed2()).toBe("3.00");
    expect($("2").cappedAt($("3")).toFixed2()).toBe("2.00");
    expect($("-2").cappedAt($("3")).isZero()).toBe(true);
    expect($("5").cappedAt($("0")).isZero()).toBe(true);
    expect($("5").cappedAt($("-1")).isZero()).toBe(true);
  });

  it("comparisons", () => {
    expect($("1.00").equals($("1"))).toBe(true);
    expect($("1").lt($("1.01"))).toBe(true);
    expect(Money.compare($("2"), $("1"))).toBe(1);
  });
});

describe("Money — formatting", () => {
  it("formats en-US with grouping", () => {
    expect($("0").format()).toBe("$0.00");
    expect($("5").format()).toBe("$5.00");
    expect($("1234.5").format()).toBe("$1,234.50");
    expect($("-1234567.891").format()).toBe("-$1,234,567.89");
    expect($("100000000000").format()).toBe("$100,000,000,000.00");
  });

  it("formatSigned for statement lines", () => {
    expect($("1180").formatSigned(false)).toBe("-$1,180.00");
    expect($("250").formatSigned(true)).toBe("+$250.00");
    expect($("-250").formatSigned(true)).toBe("+$250.00");
    expect($("0.001").formatSigned(true)).toBe("$0.00");
  });

  it("serialises to JSON as an exact 2dp string", () => {
    expect(JSON.stringify({ net: $("10.005") })).toBe('{"net":"10.01"}');
  });
});

describe("parseRate", () => {
  it("parses percentages and rates", () => {
    expect(parseRate("70")!.toString()).toBe("70");
    expect(parseRate("12.5%")!.toString()).toBe("12.5");
    expect(parseRate("1,000")!.toString()).toBe("1000");
    expect(parseRate("0.585")!.eq(new D("0.585"))).toBe(true);
    expect(parseRate("-2")!.toString()).toBe("-2");
    expect(parseRate("")).toBeNull();
    expect(parseRate("x")).toBeNull();
  });
});
