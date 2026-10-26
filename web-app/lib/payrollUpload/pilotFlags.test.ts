import { describe, expect, it } from "vitest";
import { buildPayrollProposal } from "./proposal";
import { carrierIdentityFromProfile } from "./carrierIdentity";
import * as fx from "./fixtures";
import { PROFILE, doc, input } from "./proposal.test-helpers";

// Shapes seen in the 2026-10-26 production extraction check.
const withFields = (over: Record<string, unknown>) => ({ ...fx.RATE_CON_OK, fields: { ...fx.RATE_CON_OK.fields, ...over } });
const codesOf = (raw: unknown) =>
  buildPayrollProposal(input({ document: doc(raw), identity: carrierIdentityFromProfile(PROFILE) })).warnings.map((w) => w.code);
const ev = (value: unknown, source_text: string) => ({ value, page: 1, source_text, confidence: "high" });

describe("pilot review flags", () => {
  it("clean rate con: none of the new flags", () => {
    const c = codesOf(fx.RATE_CON_OK);
    expect(c).not.toContain("carrier_mc_mismatch");
    expect(c).not.toContain("driver_ambiguous");
    expect(c).not.toContain("total_missing");
  });
  it("MC read from a combined MC#/DOT# cell (DOT number taken as MC) is flagged", () => {
    expect(codesOf(withFields({ carrier_mc_number: ev("7000001", "MC#/DOT# 900001 / 7000001") }))).toContain("carrier_mc_mismatch");
  });
  it("a single-word driver name is flagged as ambiguous", () => {
    expect(codesOf(withFields({ driver_name: ev("DEMARCUS", "Name of Driver(s): DEMARCUS") }))).toContain("driver_ambiguous");
  });
  it("a missing total carrier pay is flagged", () => {
    const f = { ...fx.RATE_CON_OK.fields } as Record<string, unknown>;
    delete f.total_revenue;
    expect(codesOf({ ...fx.RATE_CON_OK, fields: f })).toContain("total_missing");
  });
});
