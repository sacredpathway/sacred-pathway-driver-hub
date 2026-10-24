import { describe, expect, it } from "vitest";
import { Money } from "@/lib/money/money";
import {
  audit, diffEvents, eligibleLoads, inferPrefix, isDuplicateNumber, lineFromLoad, materialiseRecurring,
  nextSettlementNumber, paySettingsForDriver, recalculate, recurringIsDue, responsibilityFor,
  transitionBlocker, validate, plannedRepayments, resolveToday, type AuditAction, type LoadRow,
} from "./workflow";
import { mintNewRowIds, sanitizePayload, type EditPayload } from "./payload";
import {
  additionFromRow, additionToRow, deductionFromRow, deductionToRow, headerEditRow, headerFromRow,
  lineFromRow, lineToRow, snapToStoredPrecision,
} from "./rows";
import { encodePayRule, parsePayRule, ruleSummary } from "./payrule";
import { parseMoney, parsePercent, parseRate, parseShare } from "./input";
import { calculate } from "./engine";
import { isWebEditLocked, NO_FEES, type Deduction, type SettlementBundle } from "./model";
import { calcInputFor, displayCalculation } from "./workflow";

const P = "11111111-2222-4333-8444-555555555555";
const DRV = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function baseBundle(): SettlementBundle {
  return {
    header: {
      id: SID, profileId: P, driverId: DRV, periodStart: "2026-10-12", periodEnd: "2026-10-18",
      status: "draft", settlementNumber: "SP-2026-0007", settlementType: "company_driver", truckNumber: "12",
      payRule: { components: [{ id: uid(1), kind: "percent_of_gross", label: "Percentage of Gross", percent: "27.5", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }], feeTerms: { ...NO_FEES, factoringFeePercent: "2.5" } },
      payOnGrossRevenue: true, hoursWorked: null, notes: null, paymentMethod: null, paymentReference: null,
      driverPayPercentage: 27.5, netPay: null, isEstimate: false, engineVersion: null, createdAt: null,
      updatedAt: "2026-10-19T10:00:00.000000+00:00", approvedAt: null, approvedBy: null, paidAt: null, voidedAt: null, createdBy: P,
    },
    loadLines: [lineFromLoad({
      id: uid(50), driver_id: DRV, load_number: "45122", broker_name: "TQL", broker_mc_number: null,
      pickup_date: "2026-10-13", delivery_date: "2026-10-15", origin: "Dallas, TX", destination: "Phoenix, AZ",
      total_miles: 1065.4, empty_miles: 42, line_haul_rate: 2850.55, fuel_surcharge: 312.4, accessorial_charges: 75,
      total_revenue: 3237.95, status: "ready_for_settlement",
    }, 0)],
    additions: [],
    deductions: [],
  };
}

describe("numbering (iOS SettlementNumberService)", () => {
  it("increments per prefix + year and pads", () => {
    expect(nextSettlementNumber(["SP-2026-0007", "SP-2025-0099", "XX-2026-0100"], "2026-10-18")).toBe("SP-2026-0008");
    expect(nextSettlementNumber([], "2027-01-02")).toBe("SP-2027-0001");
    expect(inferPrefix(["HEE-2026-0001", "HEE-2026-0002", "SP-2026-0001"])).toBe("HEE");
    expect(isDuplicateNumber(" sp-2026-0007 ", ["SP-2026-0007"])).toBe(true);
  });
});

describe("driver pay defaults (iOS Driver.paySettings)", () => {
  it("stored rule wins, then flat, then legacy percent", () => {
    expect(paySettingsForDriver({ pay_percentage: 30 }, true).payRule.components[0].percent).toBe("30");
    const flat = paySettingsForDriver({ pay_type: "flat", flat_rate: 1200, pay_percentage: 30 }, true);
    expect(flat.payRule.components[0].kind).toBe("manual");
    expect(flat.payRule.components[0].fixedAmount).toBe("1200");
    expect(paySettingsForDriver({ pay_on_gross_revenue: null }, false).payOnGrossRevenue).toBe(false);
  });
  it("responsibility: lease rule → type default → company", () => {
    const s = paySettingsForDriver({ settlement_type: "lease_operator", lease_config: { rules: [{ category: "insurance", responsibility: "company", driver_share_percent: 0 }] } }, true);
    expect(responsibilityFor("insurance", s).responsibility).toBe("company");
    expect(responsibilityFor("fuel", s).responsibility).toBe("driver");
    expect(responsibilityFor("dispatcher_fee", s).responsibility).toBe("company");
  });
});

describe("load → line adapter", () => {
  it("total_revenue becomes the override only when it differs from components", () => {
    const l = baseBundle().loadLines[0];
    expect(l.grossRateOverride).toBeNull(); // 2850.55 + 312.40 + 75 = 3237.95
    const l2 = lineFromLoad({ ...{ id: uid(51), driver_id: DRV, load_number: "1", broker_name: null, broker_mc_number: null, pickup_date: null, delivery_date: "2026-10-15", origin: null, destination: null, total_miles: 0, line_haul_rate: 1000, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 1100, status: null } }, 0);
    expect(l2.grossRateOverride).toBe("1100.00");
  });
  it("eligibility excludes cancelled, other drivers, out-of-period, undelivered", () => {
    const base: LoadRow = { id: uid(60), driver_id: DRV, load_number: "A", broker_name: null, broker_mc_number: null, pickup_date: "2026-10-12", delivery_date: "2026-10-14", origin: null, destination: null, total_miles: 0, line_haul_rate: 0, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 100, status: "assigned" };
    const loads: LoadRow[] = [
      base,
      { ...base, id: uid(61), status: "cancelled" },
      { ...base, id: uid(62), driver_id: uid(99) },
      { ...base, id: uid(63), delivery_date: "2026-11-01" },
      { ...base, id: uid(64), delivery_date: "2026-10-18" }, // future vs today below
    ];
    const out = eligibleLoads(loads, DRV, "2026-10-12", "2026-10-18", new Map(), "2026-10-16");
    expect(out.map((e) => e.load.id)).toEqual([uid(60)]);
  });
});

describe("recurring deductions (iOS RecurringDeductionService)", () => {
  const rule = { id: uid(70), driverId: DRV, category: "insurance" as const, description: "Occ/Acc", amount: "45", percentOfGross: null, frequency: "weekly" as const, effectiveStartDate: "2026-01-01", effectiveEndDate: null, isActive: true, responsibility: "driver" as const, driverSharePercent: "100" };
  it("weekly is due 5+ days after last applied", () => {
    expect(recurringIsDue(rule, "2026-10-12", "2026-10-18", "2026-10-05")).toBe(true);
    expect(recurringIsDue(rule, "2026-10-12", "2026-10-18", "2026-10-08")).toBe(false);
  });
  it("percent rules price off gross and land in the 1000 band", () => {
    const d = materialiseRecurring([{ ...rule, percentOfGross: "2" }], DRV, "2026-10-12", "2026-10-18", Money.of("3237.95"), new Map());
    expect(d[0].amount).toBe("64.76");
    expect(d[0].sortOrder).toBe(1000);
    expect(d[0].notes).toBe("Recurring · 2% of gross");
  });
});

describe("recalculate + rows round trip — stored rows recalc to the same cents", () => {
  it("save → reload → recalc is identical", () => {
    const b = baseBundle();
    b.additions.push({ id: uid(80), category: "other", customCategoryId: uid(81), description: "ELD reimbursement", amount: "19.99", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null });
    b.deductions.push({ id: uid(82), category: "repair", customCategoryId: null, description: "Tire", amount: "333.33", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "split", driverSharePercent: "33.333", recurringDeductionId: null, advanceId: null, sortOrder: 2000, createdAt: null });
    const { bundle, result, totals } = recalculate(snapToStoredPrecision(b));
    // 27.5% × 3,237.95 = 890.43625 → 890.44 ; + 19.99 ; − 33.333% × 333.33 = 111.109 → 111.11
    expect(result.driverBaseEarnings.toFixed2()).toBe("890.44");
    expect(result.netDriverPay.toFixed2()).toBe("799.32");
    expect(totals.net_pay).toBe("799.32");
    expect(result.companyExpenses.toFixed2()).toBe((Money.of("80.95").plus(Money.of("222.22"))).toFixed2()); // 2.5% factoring 80.94875→80.95 + company share 222.22

    // Simulate PostgREST: numbers come back as JS numbers.
    const asDb = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o), (_k, v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v));
    const hdr = headerFromRow(asDb({ id: SID, profile_id: P, status: "draft", ...headerEditRow(bundle.header, totals, "company_driver") }));
    const reloaded: SettlementBundle = {
      header: hdr,
      loadLines: bundle.loadLines.map((l) => lineFromRow(asDb(lineToRow(l, SID, P)))),
      additions: bundle.additions.map((a) => additionFromRow(asDb(additionToRow(a, SID, P, true)))),
      deductions: bundle.deductions.map((d) => deductionFromRow(asDb(deductionToRow(d, SID, P, true)))),
    };
    const again = calculate({ ...calcInputFor(reloaded) });
    expect(again.netDriverPay.toFixed2()).toBe("799.32");
    expect(again.companyExpenses.equals(result.companyExpenses)).toBe(true);
    expect(reloaded.additions[0].customCategoryId).toBe(uid(81));
    // frozen display (paid) uses the stored per-load earnings
    reloaded.header.status = "paid";
    expect(displayCalculation(reloaded).driverBaseEarnings.toFixed2()).toBe("890.44");
  });

  it("pay rule JSON round-trips in the iPhone shape (rate 6dp, all fee keys)", () => {
    const r = baseBundle().header.payRule!;
    const enc = encodePayRule({ ...r, components: [...r.components, { id: uid(2), kind: "per_mile", label: "Per Mile", percent: null, rate: "0.5855555", mileBasis: "total", fixedAmount: null, hours: null }] });
    const ft = enc.fee_terms as Record<string, unknown>;
    expect(Object.keys(ft).sort()).toEqual([
      "authority_fee", "authority_fee_responsibility", "dispatcher_fee_percent", "dispatcher_fee_responsibility",
      "factoring_fee_percent", "factoring_fee_responsibility", "maintenance_reserve", "maintenance_reserve_responsibility",
    ]);
    const comps = enc.components as Array<Record<string, unknown>>;
    expect(comps[1].rate).toBe(0.585556);
    expect(comps[1].mile_basis).toBe("total");
    const back = parsePayRule(JSON.parse(JSON.stringify(enc)))!;
    expect(ruleSummary(back)).toBe("27.5% of gross + $0.59/mi all miles");
  });
});

describe("audit vocabulary is iPhone-safe", () => {
  const IOS: AuditAction[] = ["created", "load_added", "load_removed", "pay_rate_changed", "addition_added", "addition_removed", "deduction_added", "deduction_removed", "recurring_applied", "advance_repayment_applied", "status_changed", "approved", "marked_paid", "reopened", "voided", "manual_adjustment", "recalculated"];
  it("every diff event uses an iOS action", () => {
    const a = baseBundle();
    const b = structuredClone(a);
    b.header.periodEnd = "2026-10-19";
    b.header.notes = "x";
    b.header.payRule!.components[0].percent = "28";
    b.loadLines[0].linehaul = "2900";
    b.loadLines[0].origin = "Fort Worth, TX";
    b.additions.push({ id: uid(90), category: "bonus", customCategoryId: null, description: "Safety", amount: "100", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null });
    const ev = diffEvents(a, b);
    expect(ev.length).toBeGreaterThanOrEqual(5);
    for (const e of ev) expect(IOS).toContain(e.action);
    expect(ev.find((e) => e.action === "pay_rate_changed")!.summary).toContain("27.5% of gross");
    for (const s of ["draft", "ready_for_review", "approved", "paid", "voided"] as const) {
      expect(IOS).toContain(audit.statusChanged("approved", s, null, null).action);
    }
  });
});

describe("locks and transitions", () => {
  it("web locks approved, paid, voided", () => {
    expect(isWebEditLocked("approved")).toBe(true);
    expect(isWebEditLocked("paid")).toBe(true);
    expect(isWebEditLocked("voided")).toBe(true);
    expect(isWebEditLocked("draft")).toBe(false);
  });
  it("reopening needs a reason; paid needs approved; errors block approval", () => {
    expect(transitionBlocker("approved", "draft", [], "")).toMatch(/reason/);
    expect(transitionBlocker("approved", "draft", [], "Wrong fuel amount")).toBeNull();
    expect(transitionBlocker("paid", "approved", [], null)).toMatch(/reason/);
    expect(transitionBlocker("paid", "voided", [], null)).toMatch(/reason/);
    expect(transitionBlocker("draft", "paid", [], null)).toMatch(/cannot move straight/);
    expect(transitionBlocker("draft", "approved", [{ severity: "error", code: "x", message: "Fix me" }], null)).toBe("Fix me");
    expect(transitionBlocker("draft", "approved", [{ severity: "warning", code: "x", message: "meh" }], null)).toBeNull();
    expect(transitionBlocker("paid", "paid", [], null)).toMatch(/already paid/);
    expect(transitionBlocker("approved", "approved", [], null)).toMatch(/already approved/);
  });
  it("validation catches double pay and bad splits", () => {
    const b = baseBundle();
    b.deductions.push({ id: uid(91), category: "repair", customCategoryId: null, description: "R", amount: "10", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "split", driverSharePercent: "100", recurringDeductionId: null, advanceId: null, sortOrder: 0, createdAt: null });
    const issues = validate(b, { otherSettlementNumbers: [], alreadyPaidLoads: new Map([[uid(50), "SP-2026-0003"]]) });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["load_already_paid", "bad_split"]));
  });
  it("advance over-recovery and double-deducted expenses block approval (iPhone parity)", () => {
    const b = baseBundle();
    b.deductions.push({ id: uid(110), category: "cash_advance", customCategoryId: null, description: "Adv", amount: "5000", date: null, relatedLoadId: null, relatedExpenseId: uid(112), documentId: null, notes: null, responsibility: "driver", driverSharePercent: "100", recurringDeductionId: null, advanceId: uid(111), sortOrder: 0, createdAt: null });
    const codes = validate(b, { otherSettlementNumbers: [], alreadyPaidLoads: new Map(), advanceOutstanding: new Map([[uid(111), "500.00"]]), linkedExpenses: new Map([[uid(112), "SP-2026-0002"]]) }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["advance_over_recovery", "expense_already_linked"]));
    b.deductions[0].amount = "500";
    const ok = validate(b, { otherSettlementNumbers: [], alreadyPaidLoads: new Map(), advanceOutstanding: new Map([[uid(111), "500.00"]]), linkedExpenses: new Map() }).map((i) => i.code);
    expect(ok).not.toContain("advance_over_recovery");
  });

  it("advance repayments are the driver share only", () => {
    const b = baseBundle();
    const d: Deduction = { id: uid(92), category: "cash_advance", customCategoryId: null, description: "Adv", amount: "200", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "split", driverSharePercent: "50", recurringDeductionId: null, advanceId: uid(93), sortOrder: 0, createdAt: null };
    b.deductions.push(d);
    expect(plannedRepayments(b).map((p) => p.amount.toFixed2())).toEqual(["100.00"]);
  });
});

describe("payload gate (never trust the browser)", () => {
  const ex = () => {
    const b = baseBundle();
    b.deductions.push({ id: uid(94), category: "cash_advance", customCategoryId: null, description: "Advance", amount: "100", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "driver", driverSharePercent: "100", recurringDeductionId: null, advanceId: uid(95), sortOrder: 1500, createdAt: null });
    return b;
  };
  const payloadFrom = (b: SettlementBundle): EditPayload => ({
    header: { periodStart: b.header.periodStart!, periodEnd: b.header.periodEnd!, settlementNumber: b.header.settlementNumber ?? "", settlementType: "company_driver", truckNumber: "", payRule: b.header.payRule, payOnGrossRevenue: true, hoursWorked: "", notes: "" },
    loadLines: structuredClone(b.loadLines), additions: structuredClone(b.additions), deductions: structuredClone(b.deductions),
  });

  it("rejects sub-cent money and keeps stored links", () => {
    const b = ex();
    const p = payloadFrom(b);
    p.deductions[0].amount = "12.345";
    p.deductions[0].advanceId = null; // client tries to unlink — ignored
    const { errors, bundle } = sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() });
    expect(errors[0]).toMatch(/at most 2 decimal/);
    expect(bundle.deductions[0].advanceId).toBe(uid(95));
  });

  it("a new line can't forge an advance / recurring link or add an unapproved load", () => {
    const b = ex();
    const p = payloadFrom(b);
    p.deductions.push({ ...p.deductions[0], id: uid(96), advanceId: uid(95), recurringDeductionId: uid(97) });
    p.loadLines.push({ ...p.loadLines[0], id: uid(98), loadId: uid(99) });
    const { errors, bundle } = sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() });
    expect(bundle.deductions[1].advanceId).toBeNull();
    expect(bundle.deductions[1].recurringDeductionId).toBeNull();
    expect(errors.some((e) => e.includes("can't be added"))).toBe(true);
  });

  it("a browser-chosen id for a new row (e.g. a paid settlement's row) is replaced", () => {
    const b = ex();
    const p = payloadFrom(b);
    const foreign = uid(555); // imagine: a deduction id on another, paid settlement
    p.deductions.push({ ...p.deductions[0], id: foreign, advanceId: null });
    const { bundle } = sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() });
    mintNewRowIds(b, bundle);
    expect(bundle.deductions.map((d) => d.id)).not.toContain(foreign);
    expect(bundle.deductions[0].id).toBe(b.deductions[0].id); // existing row keeps its id
  });

  it("unknown categories and foreign custom category ids are refused/dropped", () => {
    const b = ex();
    const p = payloadFrom(b);
    p.additions.push({ id: uid(100), category: "my_new_thing" as never, customCategoryId: null, description: "x", amount: "1", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null });
    p.additions.push({ id: uid(101), category: "other", customCategoryId: uid(102), description: "ELD", amount: "1", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null });
    const { errors, bundle } = sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() });
    expect(errors.some((e) => e.includes("unknown category"))).toBe(true);
    expect(bundle.additions.find((a) => a.id === uid(101))!.customCategoryId).toBeNull();
  });
});

describe("exact input parsing", () => {
  it("money is cents-exact", () => {
    expect(parseMoney("$1,234.5")).toEqual({ ok: true, value: "1234.50" });
    expect(parseMoney("0.005").ok).toBe(false);
    expect(parseMoney("-5").ok).toBe(false);
    expect(parseMoney("(5)", "x", { allowNegative: true })).toEqual({ ok: true, value: "-5.00" });
  });
  it("rates keep 6dp, percents 4dp, shares 3dp", () => {
    expect(parseRate("0.585")).toEqual({ ok: true, value: "0.585" });
    expect(parseRate("0.1234567").ok).toBe(false);
    expect(parsePercent("27.125%")).toEqual({ ok: true, value: "27.125" });
    expect(parsePercent("101").ok).toBe(false);
    expect(parseShare("33.3333").ok).toBe(false);
  });
});

describe("iPhone legacy fallback: Decimal(Double) half-cent parity", () => {
  const legacy = (): SettlementBundle => {
    const b = baseBundle();
    b.header.payRule = null;              // no stored rule → iOS falls back to driver_pay_percentage
    b.header.driverPayPercentage = 33.33;
    b.loadLines = [{ ...b.loadLines[0], linehaul: "50.00", fuelSurcharge: "0", accessorials: "0", grossRateOverride: null }];
    return b;
  };
  it("33.33% of $50.00 = $16.665 → $16.66 like the iPhone (Decimal(33.33) = 33.32999999999999488)", () => {
    const { result, bundle, totals } = recalculate(snapToStoredPrecision(legacy()));
    expect(result.driverBaseEarnings.toFixed2()).toBe("16.66");
    expect(totals.net_pay).toBe("16.66");
    // iOS apply() stores the effective rule — same digits the iPhone would store.
    expect(bundle.header.payRule!.components[0].percent).toBe("33.32999999999999488");
    // basis text still prints 33.33% (rounded to 2 for display, like iOS)
    expect(bundle.loadLines[0].payBasisDescription).toBe("33.33% of $50.00");
  });
  it("a stored rule typed as 33.33 is exact (no fallback) → $16.67", () => {
    const b = legacy();
    b.header.payRule = { components: [{ id: uid(1), kind: "percent_of_gross", label: "Percentage of Gross", percent: "33.33", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }], feeTerms: null };
    expect(recalculate(snapToStoredPrecision(b)).result.driverBaseEarnings.toFixed2()).toBe("16.67");
  });
  it("saving on the web keeps the exact iPhone percent (not rejected, not rounded)", () => {
    const b = legacy();
    const eff = recalculate(b).bundle.header.payRule!;
    const p: EditPayload = {
      header: { periodStart: b.header.periodStart!, periodEnd: b.header.periodEnd!, settlementNumber: b.header.settlementNumber ?? "", settlementType: "company_driver", truckNumber: "", payRule: eff, payOnGrossRevenue: true, hoursWorked: "", notes: "" },
      loadLines: b.loadLines, additions: [], deductions: [],
    };
    const { errors, bundle } = sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() });
    expect(errors).toEqual([]);
    expect(bundle.header.payRule!.components[0].percent).toBe("33.32999999999999488");
    // but a NEWLY typed 5-decimal percent is still refused
    p.header.payRule = { ...eff, components: [{ ...eff.components[0], percent: "33.33333" }] };
    expect(sanitizePayload(p, { existing: b, allowedNewLoadIds: new Set(), customCategoryIds: new Set() }).errors[0]).toMatch(/at most 4 decimal/);
  });
});

describe("delivery eligibility (iPhone rule) and device day", () => {
  it("future deliveries are excluded from real settlements", () => {
    const base: LoadRow = { id: uid(700), driver_id: DRV, load_number: "F", broker_name: null, broker_mc_number: null, pickup_date: "2026-10-16", delivery_date: "2026-10-18", origin: null, destination: null, total_miles: 0, line_haul_rate: 0, fuel_surcharge: 0, accessorial_charges: 0, total_revenue: 100, status: "assigned" };
    expect(eligibleLoads([base], DRV, "2026-10-12", "2026-10-18", new Map(), "2026-10-17")).toHaveLength(0);
    expect(eligibleLoads([base], DRV, "2026-10-12", "2026-10-18", new Map(), "2026-10-18")).toHaveLength(1);
    // web-entered loads are saved ready_for_settlement = completed (owner rule: entered = delivered)
    expect(eligibleLoads([{ ...base, status: "ready_for_settlement" }], DRV, "2026-10-12", "2026-10-18", new Map(), "2026-10-17")).toHaveLength(1);
    // no delivery date and not completed → excluded (iPhone)
    expect(eligibleLoads([{ ...base, delivery_date: null }], DRV, "2026-10-12", "2026-10-18", new Map(), "2026-10-30")).toHaveLength(0);
  });
  it("browser day is used only within ±1 day of the server clock", () => {
    const now = new Date("2026-10-23T18:00:00Z");
    expect(resolveToday("2026-10-23", now)).toBe("2026-10-23");
    expect(resolveToday("2026-10-22", now)).toBe("2026-10-22");
    expect(resolveToday("2026-10-30", now)).toBe("2026-10-23"); // forged/wrong clock → HQ day
    expect(resolveToday(null, now)).toBe("2026-10-23");
  });
});
