import { describe, expect, it } from "vitest";
import { AUTO_CLASSIFICATION_MIN, AUTO_MATCH_MIN, classificationScore } from "./confidence";
import { sanitizeExtraction } from "./extraction";
import { matchDriver, matchLoad, normalizeIdentifier, normalizePersonName } from "./matching";
import { decideRouting, type DecideInput } from "./routing";
import type { DriverCandidate, LoadCandidate } from "./types";
import { CDL, FUEL, OTHER, OWNER, RATE_CON } from "./fakeRepo.test-helpers";

const load = (p: Partial<LoadCandidate>): LoadCandidate => ({
  id: p.id ?? "l1",
  profile_id: OWNER,
  load_number: "RC-1001",
  broker_name: "TQL",
  pickup_date: "2026-09-28",
  delivery_date: "2026-09-30",
  origin: "Dallas, TX",
  destination: "Atlanta, GA",
  total_revenue: 2400,
  status: "pending",
  ...p,
});
const driver = (p: Partial<DriverCandidate>): DriverCandidate => ({
  id: p.id ?? "r1",
  profile_id: OWNER,
  name: "Demarquis Hinton",
  cdl_number: "D1234567",
  cdl_state: "NM",
  active: true,
  ...p,
});

function input(raw: Record<string, unknown>, over: Partial<DecideInput> = {}): DecideInput {
  return {
    documentId: "doc1",
    ownerId: OWNER,
    extraction: sanitizeExtraction(raw),
    parseFailed: false,
    typeHint: null,
    humanCorrected: false,
    selectedLoad: null,
    loads: [],
    protectedLoadIds: new Set(),
    drivers: [],
    similarExpenses: [],
    duplicateOf: null,
    today: "2026-10-01",
    ...over,
  };
}

describe("confidence thresholds are explicit numbers", () => {
  it("only a high label with complete fields clears the classification bar", () => {
    const base = { type: "fuel_receipt", missingRequired: [], parseFailed: false, typeHint: null };
    expect(classificationScore({ ...base, modelConfidence: "high" })).toBeGreaterThanOrEqual(AUTO_CLASSIFICATION_MIN);
    expect(classificationScore({ ...base, modelConfidence: "medium" })).toBeLessThan(AUTO_CLASSIFICATION_MIN);
    expect(classificationScore({ ...base, modelConfidence: "low" })).toBeLessThan(AUTO_CLASSIFICATION_MIN);
    expect(classificationScore({ ...base, modelConfidence: null })).toBeLessThan(AUTO_CLASSIFICATION_MIN);
    expect(classificationScore({ ...base, modelConfidence: "high", missingRequired: ["x"] })).toBe(0.5);
    expect(classificationScore({ ...base, modelConfidence: "high", typeHint: "toll" })).toBe(0.5);
    expect(classificationScore({ ...base, modelConfidence: "high", type: "other" })).toBe(0);
    expect(AUTO_MATCH_MIN).toBe(0.9);
  });
});

describe("matching", () => {
  it("normalises identifiers and names", () => {
    expect(normalizeIdentifier("Load # rc-1001")).toBe("LOADRC1001");
    expect(normalizeIdentifier("RC 1001")).toBe("RC1001");
    expect(normalizeIdentifier("#1")).toBeNull();
    expect(normalizePersonName("HINTON, DEMARQUIS L.")).toBe(normalizePersonName("Demarquis Hinton"));
    expect(normalizePersonName("Cher")).toBeNull();
  });

  it("load number alone is NOT enough (0.7 < 0.9); corroboration is", () => {
    const l = load({ broker_name: null, pickup_date: null, delivery_date: null, origin: null, destination: null });
    expect(matchLoad(OWNER, [l], { identifiers: ["RC1001"] }).score).toBe(0.7);
    const m = matchLoad(OWNER, [load({})], { identifiers: ["RC1001"], broker_name: "TQL Logistics LLC", dates: ["2026-09-28"] });
    expect(m.score).toBeGreaterThanOrEqual(0.9);
    expect(m.evidence).toEqual(expect.arrayContaining(["load_number", "broker", "date"]));
  });

  it("ambiguous load numbers score 0; other accounts are ignored", () => {
    expect(matchLoad(OWNER, [load({ id: "a" }), load({ id: "b", load_number: "rc 1001" })], { identifiers: ["RC1001"] }))
      .toMatchObject({ score: 0, evidence: ["ambiguous"] });
    expect(matchLoad(OWNER, [load({ profile_id: OTHER })], { identifiers: ["RC1001"], broker_name: "TQL", dates: ["2026-09-28"] }))
      .toMatchObject({ score: 0, evidence: ["not_found"] });
  });

  it("driver: name alone 0.6; name + license 1.0; similar names never guessed", () => {
    expect(matchDriver(OWNER, [driver({})], { person_name: "Hinton, Demarquis" }).score).toBe(0.6);
    expect(matchDriver(OWNER, [driver({})], { person_name: "Hinton, Demarquis", license_number: "d1234567" }).score).toBe(1);
    const twins = [driver({ id: "a", cdl_number: null }), driver({ id: "b", cdl_number: null })];
    expect(matchDriver(OWNER, twins, { person_name: "Demarquis Hinton" })).toMatchObject({ score: 0, evidence: ["ambiguous"] });
    expect(matchDriver(OWNER, [driver({ name: "Demarcus Hinton" })], { person_name: "Demarquis Hinton" }))
      .toMatchObject({ score: 0, target_id: null });
    expect(matchDriver(OWNER, [driver({ id: "a" }), driver({ id: "b", name: "Jane Roe", cdl_number: "X9876543" })], {
      person_name: "Demarquis Hinton",
      license_number: "X9876543",
    })).toMatchObject({ score: 0, evidence: ["conflict"] });
  });
});

describe("rate confirmation routing", () => {
  it("high confidence + strong existing-load match -> automatic attach", () => {
    const d = decideRouting(input(RATE_CON(), { loads: [load({})] }));
    expect(d.decision).toBe("auto");
    expect(d.proposed).toEqual({ kind: "attach_load", load_id: "l1" });
  });

  it("unmatched rate con -> review with create_load proposal, NEVER automatic", () => {
    const d = decideRouting(input(RATE_CON(), { loads: [] }));
    expect(d.decision).toBe("review");
    expect(d.proposed).toEqual({ kind: "create_load" });
    expect(d.reasons).toEqual(expect.arrayContaining(["load_not_found", "rate_con_no_load"]));
  });

  it("matched but weak (number only) -> review", () => {
    const d = decideRouting(input(RATE_CON({ broker_name: "Other Broker", pickup_date: "2026-01-01", delivery_date: "2026-01-02", origin: "Reno, NV", destination: "Boise, ID" }), { loads: [load({})] }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("load_weak_match");
  });

  it("rate differs from the load's total -> review", () => {
    const d = decideRouting(input(RATE_CON({ total_revenue: 2900 }), { loads: [load({})] }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("rate_mismatch");
  });

  it("medium / low model confidence -> review even with a perfect match", () => {
    for (const confidence of ["medium", "low"]) {
      const d = decideRouting(input(RATE_CON({ confidence }), { loads: [load({})] }));
      expect(d.decision).toBe("review");
      expect(d.reasons).toContain("low_classification");
    }
  });

  it("disagreeing upload type hint -> review", () => {
    const d = decideRouting(input(RATE_CON(), { loads: [load({})], typeHint: "bol" }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("type_hint_mismatch");
  });
});

describe("BOL / POD routing", () => {
  const bol = { document_type: "bol", confidence: "high", load_number: "RC-1001", pickup_date: "2026-09-28", shipper_name: "Acme" };
  it("strong match -> attach", () => {
    expect(decideRouting(input(bol, { loads: [load({})] }))).toMatchObject({ decision: "auto", proposed: { kind: "attach_load" } });
    expect(decideRouting(input({ ...bol, document_type: "pod" }, { loads: [load({})] })).decision).toBe("auto");
  });
  it("weak textual similarity never attaches", () => {
    const d = decideRouting(input({ ...bol, load_number: "RC-1009" }, { loads: [load({})] }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("load_not_found");
  });
  it("no identifier -> review", () => {
    const d = decideRouting(input({ document_type: "pod", confidence: "high", bol_number: "zz" }, { loads: [load({})] }));
    expect(d.decision).toBe("review");
  });
});

describe("receipt routing", () => {
  it("high confidence, no load printed -> automatic unlinked expense", () => {
    const d = decideRouting(input(FUEL()));
    expect(d.decision).toBe("auto");
    expect(d.proposed).toMatchObject({ kind: "create_expense", expense: { category: "fuel", amount: 412.18, load_id: null } });
  });
  it.each([
    ["lumper_fee", "lumper"],
    ["toll", "toll"],
    ["repair", "maintenance"],
  ])("%s -> %s expense", (type, category) => {
    const d = decideRouting(input({ document_type: type, confidence: "high", vendor_name: "V", expense_amount: 100, receipt_date: "2026-09-29" }));
    expect(d.proposed).toMatchObject({ kind: "create_expense", expense: { category } });
  });
  it("uncertain load association -> review (no guessing)", () => {
    const d = decideRouting(input(FUEL({ load_number: "RC-1001", receipt_date: "2026-06-01" }), { loads: [load({})] }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("load_weak_match");
  });
  it("protected (settled/paid) load -> review with reason", () => {
    const d = decideRouting(input(FUEL({ load_number: "RC-1001" }), { loads: [load({})], protectedLoadIds: new Set(["l1"]) }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("load_protected");
  });
  it("possible duplicate expense -> review", () => {
    const d = decideRouting(input(FUEL(), { similarExpenses: [{ id: "e1", amount: 412.18, receipt_date: "2026-09-29", vendor_name: "Pilot", source_document_id: null }] }));
    expect(d.decision).toBe("review");
    expect(d.reasons).toContain("expense_possible_duplicate");
  });
  it("over the automatic limit, future-dated, or very old -> review", () => {
    expect(decideRouting(input(FUEL({ expense_amount: 9000 }))).reasons).toContain("expense_over_auto_limit");
    expect(decideRouting(input(FUEL({ receipt_date: "2026-12-01" }))).reasons).toContain("expense_invalid");
    expect(decideRouting(input(FUEL({ receipt_date: "2024-01-01" }))).reasons).toContain("expense_invalid");
  });
});

describe("driver documents", () => {
  it("strong driver match (name + license) -> automatic filing with expiration", () => {
    const d = decideRouting(input(CDL(), { drivers: [driver({})] }));
    expect(d.decision).toBe("auto");
    expect(d.proposed).toMatchObject({ kind: "attach_driver_document", compliance: { driver_id: "r1", document_kind: "cdl", expiration_date: "2029-04-30" } });
  });
  it("medical card + MVR classify; name-only match goes to review", () => {
    const med = decideRouting(input({ document_type: "medical_card", confidence: "high", person_name: "Demarquis Hinton", expiration_date: "2027-01-01" }, { drivers: [driver({})] }));
    expect(med.decision).toBe("review");
    expect(med.reasons).toContain("driver_weak_match");
    const mvr = decideRouting(input({ document_type: "mvr", confidence: "high", person_name: "Demarquis Hinton", license_number: "D1234567", report_date: "2026-09-01" }, { drivers: [driver({})] }));
    expect(mvr.decision).toBe("auto");
    expect(mvr.proposed).toMatchObject({ compliance: { document_kind: "mvr", expiration_date: null, issue_date: "2026-09-01" } });
  });
  it("no / ambiguous / conflicting driver -> review", () => {
    expect(decideRouting(input(CDL(), { drivers: [] })).reasons).toContain("no_driver_match");
    expect(decideRouting(input(CDL({ license_number: null }), { drivers: [driver({ id: "a" }), driver({ id: "b" })] })).reasons).toContain("driver_ambiguous");
  });
});

describe("unknown / failed / duplicate / human-corrected", () => {
  it("unknown document -> review, nothing proposed", () => {
    const d = decideRouting(input({ document_type: "other", confidence: "high" }));
    expect(d).toMatchObject({ decision: "review", proposed: null });
    expect(d.reasons).toContain("unknown_type");
  });
  it("failed parse -> review", () => {
    expect(decideRouting(input(FUEL(), { parseFailed: true })).decision).toBe("review");
  });
  it("prior duplicate file -> review", () => {
    expect(decideRouting(input(FUEL(), { duplicateOf: "doc0" })).reasons).toContain("duplicate_file");
  });
  it("human corrections never trigger automatic actions", () => {
    expect(decideRouting(input(FUEL(), { humanCorrected: true })).decision).toBe("review");
  });
});
