// =============================================================================
//  Settlement create / save core (server only — NOT a "use server" module)
// -----------------------------------------------------------------------------
//  The bodies of createSettlementAction / saveSettlementAction, unchanged,
//  so the editor and the document automation (lib/autopay) share ONE write
//  path: same eligibility, lock, version, engine, validation and audit, and
//  the same sph_web_save_settlement transaction.
//
//  `serverDeductions` exists only here: automation adds a deduction that is
//  linked to the expense / document it came from (relatedExpenseId,
//  documentId). Browser payloads can never set those links (sanitizePayload
//  keeps them only from stored rows), and this module is not callable from a
//  browser.
// =============================================================================


import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity/log";
import { Money } from "@/lib/money/money";
import {
  STATUS_LABEL,
  feesHaveAny, isWebEditLocked, lineGross, money,
  type SettlementBundle, type SettlementHeader, } from "@/lib/settlements/model";
import {
  audit, companyFeesFromProfile, diffEvents, eligibleLoads, feeTermsFor, inferPrefix,
  legacyPayOnGross, lineFromLoad, materialiseRecurring, nextSettlementNumber, paySettingsForDriver,
  isLoadCompleted, periodDescription, recalculate, resolveToday, validate, type AuditEvent, type LoadRow,
} from "@/lib/settlements/workflow";
import { headerEditRow, snapToStoredPrecision } from "@/lib/settlements/rows";
import { mintNewRowIds, rowIdMap, sanitizePayload, type EditPayload, type RowIdMap } from "@/lib/settlements/payload";
import { UUID_RE, isYmd, parseHours } from "@/lib/settlements/input";
import { cryptoId } from "@/lib/settlements/payrule";
import {
  SettlementWriteError, advanceFacts, isMissingSchema, ledgerFacts,
  lastAppliedRecurring, listCustomCategories, loadBundle, recurringRulesFor,
  saveSettlementAtomic, } from "@/lib/settlements/server";

import type { Deduction } from "@/lib/settlements/model";

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; errors?: string[] };

type Supa = Awaited<ReturnType<typeof createClient>>;
export interface CoreCtx { supabase: Supa; user: { id: string; email?: string | null }; actor: { userId: string; name: string | null } }
export interface CoreOptions { serverDeductions?: Deduction[] }

const LOAD_COLUMNS =
  "id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, " +
  "destination, total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status";

function today(clientToday?: string | null): string {
  return resolveToday(clientToday ?? null, new Date());
}

const writeError = (e: unknown) => (e instanceof SettlementWriteError ? e.message : `Save failed: ${(e as Error).message}`);

async function fetchProfile(supabase: Supa, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("dispatcher_fee_percentage, factoring_fee_percentage, authority_fee, maintenance_reserve, pay_basis")
    .eq("id", userId)
    .maybeSingle();
  return data as Record<string, number | string | null> | null;
}

export interface CreateInput {
  driverId: string;
  periodStart: string;
  periodEnd: string;
  loadIds: string[];
  applyRecurring: boolean;
  hoursWorked: string;
  /** Browser's local calendar day (YYYY-MM-DD). */
  clientToday?: string;
}

export async function createSettlementCore(c: CoreCtx, input: CreateInput, opts: CoreOptions = {}): Promise<ActionResult<{ id: string }>> {
  const { supabase, user, actor } = c;
  if (!UUID_RE.test(input.driverId ?? "")) return { ok: false, error: "Choose a driver." };
  if (!isYmd(input.periodStart) || !isYmd(input.periodEnd)) return { ok: false, error: "Choose a valid pay period." };
  if (input.periodEnd < input.periodStart) return { ok: false, error: "The pay period ends before it starts." };
  const hours = parseHours(input.hoursWorked, "Hours worked", { allowEmpty: true });
  if (!hours.ok) return { ok: false, error: hours.error };

  const { data: driver, error: dErr } = await supabase
    .from("drivers")
    .select("id, profile_id, name, truck_number, pay_percentage, pay_type, flat_rate, pay_rule, settlement_type, pay_on_gross_revenue, lease_config")
    .eq("id", input.driverId)
    .maybeSingle();
  if (dErr && isMissingSchema(dErr)) return { ok: false, error: "The Driver Pay & Settlements database update isn't on this project yet." };
  if (dErr) return { ok: false, error: dErr.message };
  if (!driver || driver.profile_id !== user.id) return { ok: false, error: "Driver not found." };

  const profile = await fetchProfile(supabase, user.id);
  const pay = paySettingsForDriver(driver, legacyPayOnGross(profile));
  const terms = feeTermsFor(companyFeesFromProfile(profile), pay);
  // iOS makeDraft: fee terms are FROZEN onto the settlement's rule.
  const rule = { ...pay.payRule, feeTerms: feesHaveAny(terms) ? terms : null };

  const facts = await ledgerFacts(supabase, null);
  const ids = [...new Set((input.loadIds ?? []).filter((x) => UUID_RE.test(x)))].slice(0, 300);
  let loads: LoadRow[] = [];
  if (ids.length > 0) {
    const { data: lRaw, error: lErr } = await supabase.from("loads").select(LOAD_COLUMNS).in("id", ids);
    if (lErr) return { ok: false, error: lErr.message };
    // iPhone eligibility (SettlementWorkflowService.eligibleLoads, real
    // settlement): completed loads only — a load whose delivery date is
    // after today is never pulled into payroll.
    const eligible = eligibleLoads((lRaw ?? []) as unknown as LoadRow[], input.driverId, input.periodStart, input.periodEnd, facts.alreadyPaid, today(input.clientToday));
    const ok = new Set(eligible.filter((e) => !e.alreadyPaidOn).map((e) => e.load.id));
    const rejected = ids.filter((x) => !ok.has(x));
    if (rejected.length > 0) return { ok: false, error: `${rejected.length} selected load${rejected.length === 1 ? " is" : "s are"} not payable yet (not delivered), cancelled, outside the period, assigned to another driver, or already paid. Refresh and pick again.` };
    const order = new Map(ids.map((x, i) => [x, i]));
    loads = eligible.map((e) => e.load).sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
  }

  const id = cryptoId();
  const header: SettlementHeader = {
    id, profileId: user.id, driverId: input.driverId,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    status: "draft",
    settlementNumber: nextSettlementNumber(facts.allNumbers, input.periodEnd, inferPrefix(facts.allNumbers)),
    settlementType: pay.settlementType,
    truckNumber: pay.defaultTruckNumber,
    payRule: rule,
    payOnGrossRevenue: pay.payOnGrossRevenue,
    hoursWorked: hours.value === "" ? null : hours.value,
    notes: null, paymentMethod: null, paymentReference: null,
    driverPayPercentage: null, netPay: null, isEstimate: false, engineVersion: null,
    createdAt: null, updatedAt: null, approvedAt: null, approvedBy: null, paidAt: null, voidedAt: null,
    createdBy: user.id,
  };
  const lines = loads.map((l, i) => lineFromLoad(l, i));
  let bundle: SettlementBundle = { header, loadLines: lines, additions: [], deductions: [] };

  const rules = await recurringRulesFor(supabase, input.driverId);
  if (input.applyRecurring && rules.length > 0) {
    const grossRounded = Money.sum(lines.map((l) => lineGross(l).rounded()));
    const last = await lastAppliedRecurring(supabase, rules.map((r) => r.id));
    bundle.deductions = materialiseRecurring(rules, input.driverId, input.periodStart, input.periodEnd, grossRounded, last);
  }

  // Server-built, trusted deductions (automation only; never from a browser).
  if (opts.serverDeductions && opts.serverDeductions.length > 0) {
    bundle.deductions = [...bundle.deductions, ...opts.serverDeductions.map((d, k) => ({ ...d, id: cryptoId(), sortOrder: bundle.deductions.length + k }))];
  }
  bundle = snapToStoredPrecision(bundle);
  const { bundle: calc, result, totals } = recalculate(bundle, rules);

  const events: AuditEvent[] = [audit.created(String(driver.name ?? "driver"), `${periodDescription(calc.header.periodStart, calc.header.periodEnd)} · ${calc.header.settlementNumber}`)];
  for (const l of calc.loadLines) events.push(audit.loadAdded(l.loadNumber, lineGross(l).rounded(), money(l.driverEarnings)));
  const rec = calc.deductions.filter((d) => d.recurringDeductionId);
  if (rec.length > 0) events.push(audit.recurringApplied(rec.length, Money.sum(rec.map((d) => money(d.amount).rounded()))));

  // Header + lines + audit in ONE transaction.
  try {
    await saveSettlementAtomic(supabase, {
      mode: "create", bundle: calc,
      headerRow: { ...headerEditRow(calc.header, totals, calc.header.settlementType ?? "company_driver"), driver_id: input.driverId },
      expectedUpdatedAt: null, audit: events, actorName: actor.name,
    });
  } catch (e) {
    return { ok: false, error: writeError(e) };
  }

  await logActivity(supabase, user.id, {
    entityType: "settlement", entityId: id, action: "created",
    metadata: { label: `Settlement ${calc.header.settlementNumber} created for ${driver.name}`, amount: result.netDriverPay.toNumber(), driver: driver.name },
  });
  return { ok: true, id };
}

export async function saveSettlementCore(
  c: CoreCtx, settlementId: string, expectedUpdatedAt: string | null, payload: EditPayload, opts: CoreOptions = {},
): Promise<ActionResult<{ updatedAt: string | null; netPay: string; idMap: RowIdMap }>> {
  if (!UUID_RE.test(settlementId ?? "")) return { ok: false, error: "Invalid settlement." };
  const { supabase, user, actor } = c;

  const loaded = await loadBundle(supabase, settlementId);
  if (!loaded) return { ok: false, error: "Settlement not found." };
  const prev = loaded.bundle;
  if (prev.header.profileId !== user.id) return { ok: false, error: "Only the carrier account can edit this settlement." };
  if (prev.header.isEstimate) return { ok: false, error: "Estimates are projections and can't be edited here." };
  if (isWebEditLocked(prev.header.status)) {
    return { ok: false, error: `This settlement is ${STATUS_LABEL[prev.header.status].toLowerCase()} and locked. Reopen it first — the reason is recorded in the audit trail.` };
  }
  if (expectedUpdatedAt && prev.header.updatedAt && expectedUpdatedAt !== prev.header.updatedAt) {
    return { ok: false, error: "This settlement was changed somewhere else (iPhone or another tab) after you opened it. Reload to see the latest version, then make your change again." };
  }

  const cats = (await listCustomCategories(supabase)).categories;

  // New load lines: only this driver's, in-account, not cancelled, not paid elsewhere.
  const facts = await ledgerFacts(supabase, settlementId);
  const existingLoadIds = new Set(prev.loadLines.map((l) => l.loadId).filter(Boolean) as string[]);
  const requested = (payload.loadLines ?? []).map((l) => l.loadId).filter((x): x is string => !!x && UUID_RE.test(x) && !existingLoadIds.has(x));
  const allowedNew = new Set<string>();
  if (requested.length > 0 && prev.header.driverId) {
    const { data: lRaw, error: lErr } = await supabase.from("loads").select(LOAD_COLUMNS).in("id", requested);
    if (lErr) return { ok: false, error: lErr.message };
    for (const l of (lRaw ?? []) as unknown as LoadRow[]) {
      const st = (l.status ?? "").trim().toLowerCase();
      // Same rule as the picker and the iPhone: delivered (completed) loads only.
      if (l.driver_id === prev.header.driverId && st !== "cancelled" && st !== "canceled"
        && !facts.alreadyPaid.has(l.id) && isLoadCompleted(l, today())) allowedNew.add(l.id);
    }
  }

  const { bundle: cleaned, errors } = sanitizePayload(payload, {
    existing: prev, allowedNewLoadIds: allowedNew, customCategoryIds: new Set(cats.map((c) => c.id)),
  });
  if (errors.length > 0) return { ok: false, error: errors[0], errors };

  // Row ids for NEW lines are minted here, never taken from the browser: a
  // client-chosen id could match a row on another (e.g. paid) settlement and
  // the upsert would move it. Existing rows keep ids proven to belong here.
  const beforeMint = { ...cleaned, loadLines: [...cleaned.loadLines], additions: [...cleaned.additions], deductions: [...cleaned.deductions] };
  mintNewRowIds(prev, cleaned);
  const idMap = rowIdMap(beforeMint, cleaned);
  // Server-built, trusted deductions (automation only; never from a browser).
  if (opts.serverDeductions && opts.serverDeductions.length > 0) {
    cleaned.deductions = [...cleaned.deductions, ...opts.serverDeductions.map((d, k) => ({ ...d, id: cryptoId(), sortOrder: cleaned.deductions.length + k }))];
  }

  const rules = await recurringRulesFor(supabase, prev.header.driverId);
  const { bundle: next, result, totals } = recalculate(snapToStoredPrecision(cleaned), rules);

  const issues = validate(next, { otherSettlementNumbers: facts.otherNumbers, alreadyPaidLoads: facts.alreadyPaid, ...(await advanceFacts(supabase, settlementId, next)) }, result);
  const dup = issues.find((i) => i.code === "duplicate_number");
  if (dup) return { ok: false, error: dup.message };

  const nameOf = (cid: string | null) => (cid ? cats.find((c) => c.id === cid)?.name ?? null : null);
  const events = diffEvents(prev, next, nameOf);
  const recalc = audit.recalculated(prev.header.netPay === null ? null : Money.fromNumber(prev.header.netPay), result.netDriverPay, result.engineVersion);
  if (recalc) events.push(recalc);

  // Every save leaves a trace, even one that changes no tracked figure.
  if (events.length === 0) events.push(audit.manual("Settlement saved (no figure changes)", null, null));

  // Header + lines + audit in ONE transaction; the database re-checks the
  // lock, ownership, updated_at and that no line belongs to another settlement.
  let updatedAt: string | null = null;
  try {
    ({ updatedAt } = await saveSettlementAtomic(supabase, {
      mode: "update", bundle: next,
      headerRow: headerEditRow(next.header, totals, next.header.settlementType ?? "company_driver"),
      expectedUpdatedAt: prev.header.updatedAt, audit: events, actorName: actor.name,
    }));
  } catch (e) {
    return { ok: false, error: writeError(e) };
  }

  if (events.length > 0) {
    await logActivity(supabase, user.id, {
      entityType: "settlement", entityId: settlementId, action: "updated",
      metadata: { label: `Settlement ${next.header.settlementNumber ?? ""} updated (${events.length} change${events.length === 1 ? "" : "s"})`.replace("  ", " "), amount: result.netDriverPay.toNumber() },
    });
  }
  return { ok: true, updatedAt, netPay: result.netDriverPay.toFixed2(), idMap };
}
