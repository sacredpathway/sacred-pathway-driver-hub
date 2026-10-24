// =============================================================================
//  Settlement server actions — the ONE live payroll workflow on the web
// -----------------------------------------------------------------------------
//  Owner decision (2026-10): the iPhone settlement model is the single active
//  payroll system for web and iOS. Web paystubs are read-only legacy history.
//
//  Every action:
//    1. authenticates and confirms the settlement belongs to this account;
//    2. never trusts browser totals — the shared engine (lib/settlements)
//       recalculates from the stored-precision values, exactly like iOS;
//    3. refuses to edit approved / paid / voided settlements until they are
//       explicitly reopened (with a reason, recorded in the audit trail);
//    4. writes iPhone-compatible rows and audit events (same vocabulary), so
//       Driver Hub on the phone loads and recalculates them to the same cents.
//
//  Database guards from 20261001120100 still apply: approving a settlement
//  that pays a cancelled load or a load already paid elsewhere is rejected by
//  the database whichever client acts first.
// =============================================================================

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity/log";
import { Money } from "@/lib/money/money";
import {
  ADDITION_CATEGORIES, DEDUCTION_CATEGORIES, RESPONSIBILITIES, STATUS_LABEL,
  feesHaveAny, isIosLocked, isWebEditLocked, lineGross, money,
  type SettlementBundle, type SettlementHeader, type SettlementStatus,
} from "@/lib/settlements/model";
import {
  audit, companyFeesFromProfile, diffEvents, eligibleLoads, feeTermsFor, inferPrefix,
  legacyPayOnGross, lineFromLoad, materialiseRecurring, nextSettlementNumber, paySettingsForDriver,
  isLoadCompleted, periodDescription, recalculate, resolveToday, transitionBlocker, validate, errorsOf,
  type AuditEvent, type LoadRow,
} from "@/lib/settlements/workflow";
import { headerEditRow, snapToStoredPrecision } from "@/lib/settlements/rows";
import { mintNewRowIds, sanitizePayload, type EditPayload } from "@/lib/settlements/payload";
import { UUID_RE, isYmd, parseHours, parseShare } from "@/lib/settlements/input";
import { cryptoId, ruleSummary } from "@/lib/settlements/payrule";
import {
  SettlementWriteError, advanceFacts, isMissingSchema, ledgerFacts,
  lastAppliedRecurring, listCustomCategories, loadBundle, recurringRulesFor,
  saveSettlementAtomic, transitionSettlementAtomic,
} from "@/lib/settlements/server";

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; errors?: string[] };

const LOAD_COLUMNS =
  "id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, " +
  "destination, total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status";

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user, actor: { userId: user.id, name: user.email ?? null } };
}

/** "Today" for delivery eligibility = the user's device day (iPhone rule),
 *  accepted only within ±1 day of the server clock; else America/Chicago. */
function today(clientToday?: string | null): string {
  return resolveToday(clientToday ?? null, new Date());
}

const writeError = (e: unknown) => (e instanceof SettlementWriteError ? e.message : `Save failed: ${(e as Error).message}`);

function revalidateAll(id?: string) {
  revalidatePath("/settlements");
  revalidatePath("/payroll");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/settlements/${id}`);
}

async function fetchProfile(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("dispatcher_fee_percentage, factoring_fee_percentage, authority_fee, maintenance_reserve, pay_basis")
    .eq("id", userId)
    .maybeSingle();
  return data as Record<string, number | string | null> | null;
}

// =============================================================================
//  Create
// =============================================================================

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

export async function createSettlementAction(input: CreateInput): Promise<ActionResult<{ id: string }>> {
  const { supabase, user, actor } = await ctx();
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
  revalidateAll(id);
  return { ok: true, id };
}

/** Form wrapper: create then land in the editor. */
export async function createSettlementAndOpenAction(input: CreateInput): Promise<ActionResult<{ id: string }>> {
  const r = await createSettlementAction(input);
  if (r.ok) redirect(`/settlements/${r.id}?created=1`);
  return r;
}

// =============================================================================
//  Save (draft / ready for review only)
// =============================================================================

export async function saveSettlementAction(
  settlementId: string, expectedUpdatedAt: string | null, payload: EditPayload,
): Promise<ActionResult<{ updatedAt: string | null; netPay: string }>> {
  if (!UUID_RE.test(settlementId ?? "")) return { ok: false, error: "Invalid settlement." };
  const { supabase, user, actor } = await ctx();

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
  mintNewRowIds(prev, cleaned);

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
  revalidateAll(settlementId);
  return { ok: true, updatedAt, netPay: result.netDriverPay.toFixed2() };
}

// =============================================================================
//  Status transitions (finalize / pay / reopen / void)
// =============================================================================

export interface TransitionInput {
  target: SettlementStatus;
  reason?: string;
  paymentMethod?: string;
  paymentReference?: string;
  expectedUpdatedAt: string | null;
}

export async function transitionSettlementAction(settlementId: string, input: TransitionInput): Promise<ActionResult> {
  if (!UUID_RE.test(settlementId ?? "")) return { ok: false, error: "Invalid settlement." };
  const { supabase, user, actor } = await ctx();
  const loaded = await loadBundle(supabase, settlementId);
  if (!loaded) return { ok: false, error: "Settlement not found." };
  const b = loaded.bundle;
  if (b.header.profileId !== user.id) return { ok: false, error: "Only the carrier account can change this settlement." };
  if (b.header.isEstimate) return { ok: false, error: "Estimates cannot be approved or paid." };
  if (input.expectedUpdatedAt && b.header.updatedAt && input.expectedUpdatedAt !== b.header.updatedAt) {
    return { ok: false, error: "This settlement was changed somewhere else after you opened it. Reload and try again." };
  }
  const from = b.header.status;
  const to = input.target;
  if (from === to) return { ok: false, error: `This settlement is already ${STATUS_LABEL[to].toLowerCase()}.` };
  const reason = (input.reason ?? "").trim().slice(0, 500) || null;

  const facts = await ledgerFacts(supabase, settlementId);
  const rules = await recurringRulesFor(supabase, b.header.driverId);
  const { bundle: calc, result, totals } = recalculate(snapToStoredPrecision(b), rules);
  const probe: SettlementBundle = { ...calc, header: { ...calc.header } };
  if ((to === "approved" || to === "paid") && !probe.header.settlementNumber) {
    probe.header.settlementNumber = nextSettlementNumber(facts.allNumbers, probe.header.periodEnd ?? today(), inferPrefix(facts.allNumbers));
  }
  const issues = validate(probe, { otherSettlementNumbers: facts.otherNumbers, alreadyPaidLoads: facts.alreadyPaid, ...(await advanceFacts(supabase, settlementId, probe)) }, result);
  const blocker = transitionBlocker(from, to, issues, reason);
  if (blocker) return { ok: false, error: blocker, errors: errorsOf(issues).map((i) => i.message) };

  // Stored totals must equal the engine before money is committed. A stale
  // header (e.g. a percent-of-gross recurring rule changed since the last
  // save) is refreshed first — itself one atomic save with its audit row.
  const storedNet = b.header.netPay === null ? null : Money.fromNumber(b.header.netPay).rounded();
  const totalsStale = to === "approved" && from !== "paid" && (storedNet === null || !storedNet.equals(result.netDriverPay));
  const refreshAudit = totalsStale ? audit.recalculated(storedNet, result.netDriverPay, result.engineVersion) : null;
  const refresh = totalsStale ? {
    mode: "update" as const, bundle: calc,
    headerRow: headerEditRow(calc.header, totals, calc.header.settlementType ?? "company_driver"),
    expectedUpdatedAt: b.header.updatedAt,
    audit: refreshAudit ? [refreshAudit] : [audit.manual("Totals refreshed before approval", null, null)],
    actorName: actor.name,
  } : undefined;

  const events: AuditEvent[] = [];
  if (isIosLocked(from) && !isIosLocked(to) && reason) events.push(audit.reopened(from, reason));
  events.push(audit.statusChanged(from, to, result.netDriverPay, to === "paid" ? (input.paymentReference ?? null) : reason));

  // Status, advance repayments + balances, load flags and audit: ONE
  // transaction. The double-pay trigger fires inside; a rejection leaves
  // nothing behind.
  try {
    await transitionSettlementAtomic(supabase, {
      settlementId, expectedUpdatedAt: b.header.updatedAt, from, to, reason, refresh,
      settlementNumber: to === "approved" && !b.header.settlementNumber ? probe.header.settlementNumber : null,
      paymentMethod: to === "paid" ? (input.paymentMethod ?? "").trim().slice(0, 60) || null : null,
      paymentReference: to === "paid" ? (input.paymentReference ?? "").trim().slice(0, 120) || null : null,
      audit: events, actorName: actor.name,
    });
  } catch (e) {
    return { ok: false, error: writeError(e) };
  }

  await logActivity(supabase, user.id, {
    entityType: "settlement", entityId: settlementId,
    action: to === "approved" ? "approved" : to === "paid" ? "paid" : to === "voided" ? "voided" : "updated",
    metadata: { label: `Settlement ${probe.header.settlementNumber ?? ""}: ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`, amount: result.netDriverPay.toNumber(), from, to },
  });
  revalidateAll(settlementId);
  return { ok: true };
}

// =============================================================================
//  Custom categories
// =============================================================================

export interface CategoryInput {
  kind: "addition" | "deduction";
  name: string;
  baseCategory: string;
  defaultResponsibility: string;
  defaultDriverSharePercent: string;
}

const NOT_APPLIED = "Saved custom categories need the payroll categories database update (not applied yet). You can still type any category name on a line — it saves as an “Other” line with that name.";

export async function createCustomCategoryAction(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await ctx();
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return { ok: false, error: "Category name must be 1–60 characters." };
  const kind = input.kind === "addition" ? "addition" : "deduction";
  const allowed = kind === "addition" ? (ADDITION_CATEGORIES as readonly string[]) : (DEDUCTION_CATEGORIES as readonly string[]);
  const base = allowed.includes(input.baseCategory) ? input.baseCategory : "other";
  const resp = (RESPONSIBILITIES as readonly string[]).includes(input.defaultResponsibility) ? input.defaultResponsibility : "driver";
  let share = resp === "driver" ? "100" : resp === "company" ? "0" : "50";
  if (resp === "split") {
    const s = parseShare(input.defaultDriverSharePercent);
    if (!s.ok) return { ok: false, error: s.error };
    share = s.value;
  }
  const { data, error } = await supabase.from("payroll_custom_categories").insert({
    profile_id: user.id, kind, name, base_category: base,
    default_responsibility: resp, default_driver_share_percent: share,
  }).select("id").single();
  if (error) {
    if (isMissingSchema(error)) return { ok: false, error: NOT_APPLIED };
    if (error.code === "23505") return { ok: false, error: `A ${kind} category named “${name}” already exists.` };
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/payroll-categories");
  return { ok: true, id: String(data.id) };
}

export async function updateCustomCategoryAction(id: string, patch: { name?: string; isArchived?: boolean }): Promise<ActionResult> {
  if (!UUID_RE.test(id ?? "")) return { ok: false, error: "Invalid category." };
  const { supabase } = await ctx();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 60) return { ok: false, error: "Category name must be 1–60 characters." };
    row.name = name;
  }
  if (patch.isArchived !== undefined) row.is_archived = !!patch.isArchived;
  const { error } = await supabase.from("payroll_custom_categories").update(row).eq("id", id);
  if (error) {
    if (isMissingSchema(error)) return { ok: false, error: NOT_APPLIED };
    if (error.code === "23505") return { ok: false, error: "Another category already uses that name." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/payroll-categories");
  return { ok: true };
}

// =============================================================================
//  Legacy: web paystubs are retired (read-only history)
// =============================================================================

/**
 * Formerly seeded a draft web paystub from a legacy iOS settlement. The
 * paystub model is retired as an active payroll system, so this no longer
 * creates paystubs. Kept as an explicit refusal so an old form post can't
 * create one.
 */
export async function convertLegacySettlementToPaystubAction(_settlementId: string): Promise<void> {
  throw new Error("Web paystubs are read-only legacy records. Pay drivers through Settlements.");
}

// =============================================================================
//  New-settlement picker: the driver's loads for a period, iPhone eligibility
// =============================================================================

export interface PickerLoad {
  id: string;
  loadNumber: string | null;
  date: string | null;
  route: string;
  gross: string;
  status: string | null;
  completed: boolean;
  alreadyPaidOn: string | null;
}

export async function previewEligibleLoadsAction(
  driverId: string, periodStart: string, periodEnd: string, clientToday?: string,
): Promise<ActionResult<{ loads: PickerLoad[]; hasRecurring: boolean; payRuleSummary: string }>> {
  if (!UUID_RE.test(driverId ?? "") || !isYmd(periodStart) || !isYmd(periodEnd)) return { ok: false, error: "Pick a driver and a valid period." };
  const { supabase, user } = await ctx();
  const [{ data: lRaw, error }, facts, rules, { data: driver }, profile] = await Promise.all([
    supabase.from("loads").select(LOAD_COLUMNS).eq("driver_id", driverId),
    ledgerFacts(supabase, null),
    recurringRulesFor(supabase, driverId),
    supabase.from("drivers").select("id, profile_id, pay_percentage, pay_type, flat_rate, pay_rule, settlement_type, pay_on_gross_revenue, lease_config, truck_number").eq("id", driverId).maybeSingle(),
    fetchProfile(supabase, user.id),
  ]);
  if (error) return { ok: false, error: error.message };
  // Shown for context, but only completed loads are selectable (iPhone rule).
  const loads = eligibleLoads((lRaw ?? []) as unknown as LoadRow[], driverId, periodStart, periodEnd, facts.alreadyPaid, today(clientToday), { includeInProgress: true });
  const pay = driver ? paySettingsForDriver(driver, legacyPayOnGross(profile)) : null;
  return {
    ok: true,
    hasRecurring: rules.some((r) => r.isActive),
    payRuleSummary: pay ? ruleSummary(pay.payRule) : "No pay rule set",
    loads: loads.map((e) => ({
      id: e.load.id,
      loadNumber: e.load.load_number,
      date: (e.load.delivery_date ?? e.load.pickup_date ?? "").slice(0, 10) || null,
      route: [e.load.origin, e.load.destination].filter(Boolean).join(" → "),
      gross: lineGross(lineFromLoad(e.load, 0)).rounded().toFixed2(),
      status: e.load.status,
      completed: e.isCompleted || e.legacySettled,
      alreadyPaidOn: e.alreadyPaidOn,
    })),
  };
}
