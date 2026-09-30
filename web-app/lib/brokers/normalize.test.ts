import { describe, expect, it } from "vitest";
import { combineBrokerPhone, normalizeBrokerName } from "./normalize";

describe("normalizeBrokerName (parity with iOS Broker.normalize)", () => {
  it.each([
    ["TQL", "total quality logistics"],
    ["  CH Robinson ", "c.h. robinson"],
    ["J B Hunt", "j.b. hunt"],
    ["Acme Inc", "acme"],
    ["Acme LLC.", "acme"],
    ["Acme Logistics LLC", "acme"],             // " llc" then " logistics", in Swift's order
    ["Swift Transportation", "swift"],
    ["Blue Freight Trucking", "blue freight"],
    ["Coyote", "coyote logistics"],
  ])("%s → %s", (input, want) => {
    expect(normalizeBrokerName(input)).toBe(want);
  });
});

describe("combineBrokerPhone (iOS combinedPhone convention)", () => {
  it("appends the extension as ' x<ext>'", () => {
    expect(combineBrokerPhone("(555) 555-0123", "202")).toBe("(555) 555-0123 x202");
    expect(combineBrokerPhone("(555) 555-0123", "x202")).toBe("(555) 555-0123 x202");
    expect(combineBrokerPhone("(555) 555-0123", "")).toBe("(555) 555-0123");
    expect(combineBrokerPhone(null, "202")).toBeNull();
  });
});
