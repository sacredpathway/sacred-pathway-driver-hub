import { describe, expect, it } from "vitest";
import { swiftDecimalFromDouble } from "./swiftDecimal";

describe("swiftDecimalFromDouble — Foundation Decimal(Double) parity", () => {
  it("matches Apple-reported values", () => {
    expect(swiftDecimalFromDouble(76.84)).toBe("76.84000000000002048"); // SR-11514 (Darwin)
    expect(swiftDecimalFromDouble(456.789)).toBe("456.7889999999998976"); // SR-8409
    expect(swiftDecimalFromDouble(3.133)).toBe("3.132999999999999488");
  });
  it("keeps exact binary values exact", () => {
    for (const v of [70, 27.5, 12.5, 2.5, 100, 25, 0.5]) expect(swiftDecimalFromDouble(v)).toBe(String(v));
    expect(swiftDecimalFromDouble(0)).toBe("0");
  });
  it("33.33 lands below 33.33 (the half-cent case)", () => {
    expect(swiftDecimalFromDouble(33.33)).toBe("33.32999999999999488");
  });
  it("agrees with an independent Python simulation for typical driver rates", () => {
    // python3: Foundation algorithm, see scratch dec.py
    const expected: Record<string, string> = { "33.33": "33.32999999999999488", "76.84": "76.84000000000002048", "27.5": "27.5", "70": "70" };
    for (const [k, v] of Object.entries(expected)) expect(swiftDecimalFromDouble(Number(k))).toBe(v);
  });
});
