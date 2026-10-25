import { describe, expect, it } from "vitest";
import { decideAutoCreateLoad, type AutoCreateInput } from "./autoCreateLoad";
import { sanitizePayrollExtraction } from "./payrollExtraction";
import { processDocument } from "./pipeline";
import { addDoc, addDriver, addLoad, createFakeRepo, newState, OTHER, OWNER, toV3Raw } from "./fakeRepo.test-helpers";
import { carrierIdentityFromProfile } from "../payrollUpload/carrierIdentity";
import { payPeriodFor } from "../autopay/period";

const IDENTITY = carrierIdentityFromProfile({ id: OWNER, company_name: "Sacred Test Carrier LLC", mc_number: "MC777001", dot_number: null, account_type: "carrier", account_role: null })!;
const RC = (over: Record<string, unknown> = {}) => ({
  document_type: "rate_confirmation", confidence: "high", load_number: "NEW-5001", broker_name: "Blue Ridge Logistics", broker_mc_number: "500100",
  carrier_name: "Sacred Test Carrier LLC", carrier_mc_number: "MC777001", driver_name: "Marcus Reed",
  origin: "Dallas, TX", destination: "Houston, TX", pickup_date: "2026-09-28", delivery_date: "2026-09-29",
  total_miles: 240, line_haul_rate: 1850, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 1850, ...over,
});
const drivers = [
  { id: "d1", profile_id: OWNER, name: "Marcus Reed", cdl_number: null, cdl_state: null, active: true },
  { id: "d2", profile_id: OWNER, name: "Tina Alvarez", cdl_number: null, cdl_state: null, active: true },
];
function input(over: Partial<AutoCreateInput> = {}, rc: Record<string, unknown> = {}): AutoCreateInput {
  return {
    extraction: sanitizePayrollExtraction(toV3Raw(RC(rc))), parseStage: "strict", humanCorrected: false, duplicateOf: null, typeHintMismatch: false,
    identity: IDENTITY, ownerId: OWNER, drivers, loads: [], today: "2026-10-01", ...over,
  };
}

describe("decideAutoCreateLoad — only fully verified rate cons create loads", () => {
  it("everything verified -> eligible, with the stored values and the matched driver", () => {
    const d = decideAutoCreateLoad(input());
    expect(d).toMatchObject({ eligible: true, driverName: "Marcus Reed", row: { load_number: "NEW-5001", total_revenue: 1850, line_haul_rate: 1850, driver_id: "d1", pickup_date: "2026-09-28", delivery_date: "2026-09-29" } });
  });
  const cases: Array<[string, Partial<AutoCreateInput>, Record<string, unknown>, string]> = [
    ["medium confidence", {}, { confidence: "medium" }, "not_high_confidence"],
    ["someone else's load (carrier MC + name differ)", {}, { carrier_name: "Other Trucking", carrier_mc_number: "MC999999" }, "carrier_not_ours"],
    ["no carrier printed", {}, { carrier_name: undefined, carrier_mc_number: undefined }, "carrier_not_printed"],
    ["profile has no identity", { identity: null }, {}, "identity_unverified"],
    ["no driver printed", {}, { driver_name: undefined }, "no_driver_printed"],
    ["unknown driver", {}, { driver_name: "Pat Nobody" }, "driver_not_unique"],
    ["load number already one of ours", { loads: [{ id: "l1", profile_id: OWNER, load_number: "new 5001", broker_name: null, pickup_date: null, delivery_date: null, origin: null, destination: null, total_revenue: 1, status: "cancelled" }] }, {}, "load_number_exists"],
    ["no load number", {}, { load_number: undefined }, "no_load_number"],
    ["delivery before pickup", {}, { delivery_date: "2026-09-20" }, "dates_invalid"],
    ["missing destination", {}, { destination: undefined }, "missing_fields"],
    ["$0 revenue", {}, { total_revenue: 0, line_haul_rate: 0 }, "no_revenue"],
    ["components don't add up", {}, { line_haul_rate: 1700 }, "validation"],
    ["hand-corrected", { humanCorrected: true }, {}, "human_corrected"],
    ["duplicate upload", { duplicateOf: "x" }, {}, "duplicate_upload"],
    ["failed parse", { parseStage: "fallback" }, {}, "parse_failed"],
  ];
  for (const [name, over, rc, reason] of cases) {
    it(`${name} -> review (${reason})`, () => {
      const d = decideAutoCreateLoad(input(over, rc));
      expect(d.eligible).toBe(false);
      if (!d.eligible) expect(d.reasons).toContain(reason);
    });
  }
  it("a value without quoted evidence is never trusted for an automatic load", () => {
    const raw = toV3Raw(RC()) as { fields: Record<string, { source_text: string | null }> };
    raw.fields.total_revenue.source_text = null;
    const d = decideAutoCreateLoad({ ...input(), extraction: sanitizePayrollExtraction(raw) });
    expect(d.eligible).toBe(false);
    if (!d.eligible) expect(d.reasons).toContain("validation");
  });
  it("another carrier's matching load number doesn't count as ours (still eligible)", () => {
    const d = decideAutoCreateLoad(input({ loads: [{ id: "x", profile_id: OTHER, load_number: "NEW-5001", broker_name: null, pickup_date: null, delivery_date: null, origin: null, destination: null, total_revenue: 1, status: "pending" }] }));
    expect(d.eligible).toBe(true);
  });
});

function setup(mode: "guarded" | "fallback" = "guarded") {
  const st = newState(); st.v3 = true; st.autoCreate = true; st.identity = IDENTITY; st.createMode = mode;
  addDriver(st, { name: "Marcus Reed" });
  const repo = createFakeRepo(st);
  return { st, repo };
}

describe("pipeline: rate con for an unknown load", () => {
  it("verified -> load created with the driver, document attached, filed automatically", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC());
    const out = await processDocument(repo, doc.id);
    expect(out.state).toBe("auto_routed");
    expect(st.createdLoads).toHaveLength(1);
    const d = st.docs.get(doc.id)!;
    expect(d.load_id).toBe(st.createdLoads![0]);
    expect(d.routing!.applied.map((a) => [a.kind, a.mode])).toEqual([["create_load", "automatic"], ["attach_load", "automatic"]]);
  });
  it("switched off -> unchanged behaviour: review with the Create-load proposal", async () => {
    const { st, repo } = setup();
    st.autoCreate = false;
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC());
    expect((await processDocument(repo, doc.id)).state).toBe("needs_review");
    expect(st.createdLoads ?? []).toHaveLength(0);
    expect(st.docs.get(doc.id)!.routing!.proposed).toEqual({ kind: "create_load" });
  });
  it("not verified -> review, reasons recorded, no load", async () => {
    const { st, repo } = setup();
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC({ driver_name: "Pat Nobody" }));
    expect((await processDocument(repo, doc.id)).state).toBe("needs_review");
    expect(st.createdLoads ?? []).toHaveLength(0);
    expect((st.docs.get(doc.id)!.routing as unknown as { auto_create: { reasons: string[] } }).auto_create.reasons).toContain("driver_not_unique");
  });
  it("load already exists -> normal attach path, never a second load", async () => {
    const { st, repo } = setup();
    addLoad(st, { load_number: "NEW-5001", broker_name: "Blue Ridge Logistics", pickup_date: "2026-09-28", delivery_date: "2026-09-29", origin: "Dallas, TX", destination: "Houston, TX", total_revenue: 1850 });
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC());
    expect((await processDocument(repo, doc.id)).state).toBe("auto_routed");
    expect(st.createdLoads ?? []).toHaveLength(0);
    expect(st.loads).toHaveLength(1);
  });
  it("race, database-guarded (migration #5): the other upload's load is joined, nothing deleted", async () => {
    const { st, repo } = setup("guarded");
    st.raceInsert = "NEW-5001";
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC());
    expect((await processDocument(repo, doc.id)).state).toBe("auto_routed");
    expect(st.loads.filter((l) => l.load_number === "NEW-5001")).toHaveLength(1);
    const d = st.docs.get(doc.id)!;
    expect(d.load_id).toBe("00000000-race-4000-8000-000000000000");
    expect(d.routing!.applied.map((a) => a.kind)).toEqual(["attach_load"]); // we didn't create it
  });
  it("race without migration #5: both inserted; the loser removes its own row and joins the winner", async () => {
    const { st, repo } = setup("fallback");
    st.raceInsert = "NEW-5001";
    const doc = addDoc(st);
    st.modelOutput.set(doc.id, RC());
    expect((await processDocument(repo, doc.id)).state).toBe("auto_routed");
    expect(st.loads.filter((l) => l.load_number === "NEW-5001")).toHaveLength(1);
    expect(st.docs.get(doc.id)!.load_id).toBe("00000000-race-4000-8000-000000000000");
  });
});

describe("pay period", () => {
  it("default / weekly = Monday–Sunday", () => {
    expect(payPeriodFor("2026-10-14", { frequency: null, recent: [] })).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(payPeriodFor("2026-10-14", { frequency: "weekly", recent: [] })).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });
  it("semimonthly and monthly follow the calendar", () => {
    expect(payPeriodFor("2026-10-14", { frequency: "semimonthly", recent: [] })).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(payPeriodFor("2026-10-16", { frequency: "semimonthly", recent: [] })).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(payPeriodFor("2027-02-20", { frequency: "semimonthly", recent: [] })).toEqual({ start: "2027-02-16", end: "2027-02-28" });
    expect(payPeriodFor("2026-10-14", { frequency: "monthly", recent: [] })).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
  it("biweekly continues the last two-week settlement; without one it is held", () => {
    const recent = [{ start: "2026-09-28", end: "2026-10-11" }];
    expect(payPeriodFor("2026-10-14", { frequency: "biweekly", recent })).toEqual({ start: "2026-10-12", end: "2026-10-25" });
    expect(payPeriodFor("2026-10-30", { frequency: "biweekly", recent })).toEqual({ start: "2026-10-26", end: "2026-11-08" });
    expect(payPeriodFor("2026-10-14", { frequency: "biweekly", recent: [{ start: "2026-10-05", end: "2026-10-11" }] })).toMatchObject({ code: "pay_period_unknown" });
  });
});
