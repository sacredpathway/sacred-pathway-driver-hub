// =============================================================================
//  Document automation — pipeline + executor
// -----------------------------------------------------------------------------
//  Website upload -> claim -> extract (Edge Function v2) -> decide -> apply.
//  All I/O goes through `DocumentRepo`, implemented with the signed-in
//  user's Supabase client (RLS) in repo.ts and with an in-memory fake in
//  tests. Every write re-checks ownership in code as well as via RLS.
//
//  Idempotency:
//    * extraction is claimed with a conditional status update
//      (pending | failed | stale processing -> processing); a second caller
//      gets "busy";
//    * routing is claimed with a conditional `review_status IS NULL` update,
//      so a document is decided once;
//    * expenses / driver documents carry a UNIQUE source_document_id, so a
//      retry can never create a second one (unique violation => reuse);
//    * attach_load is a conditional update (load_id null or already X).
// =============================================================================

import { decideRouting, effectiveExtraction, type Decision } from "./routing";
import { normalizeIdentifier } from "./matching";
import { isRoutableVersion } from "./versions";
import { DOCUMENT_TYPE_GROUP, isCanonicalDocumentType, routableDocumentType } from "./taxonomy";
import type {
  AppliedAction,
  AutomationDocument,
  ComplianceDraft,
  DriverCandidate,
  ExpenseDraft,
  ExpenseSimilar,
  LoadCandidate,
  ProposedAction,
  ReviewReason,
  ReviewStatus,
  RoutingEvent,
  RoutingRecord,
} from "./types";

/** A `processing` claim older than this may be taken over (crashed run). */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export interface ExtractorResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export type InsertResult<T> = { ok: true; row: T } | { ok: false; code: "unique" | "protected" | "error"; message: string };

export interface DocumentRepo {
  ownerId: string;
  now(): Date;
  getDocument(id: string): Promise<AutomationDocument | null>;
  claimExtraction(id: string, staleBeforeIso: string): Promise<boolean>;
  invokeExtractor(id: string, typeHint: string | null): Promise<ExtractorResult>;
  markExtractionFailed(id: string, message: string): Promise<void>;
  resetForRetry(id: string, routing: RoutingRecord | null): Promise<boolean>;
  /** Loads whose load_number may normalise to one of `identifiers`. */
  findLoadCandidates(identifiers: string[]): Promise<LoadCandidate[]>;
  getLoad(id: string): Promise<LoadCandidate | null>;
  protectedLoadIds(ids: string[]): Promise<Set<string>>;
  listDrivers(): Promise<DriverCandidate[]>;
  findSimilarExpenses(amount: number, date: string): Promise<ExpenseSimilar[]>;
  claimRouting(id: string, status: ReviewStatus, routing: RoutingRecord): Promise<boolean>;
  saveRouting(id: string, status: ReviewStatus, routing: RoutingRecord, reviewed: boolean): Promise<void>;
  setDocumentLoad(id: string, loadId: string | null, expectedCurrent: string | null): Promise<boolean>;
  insertExpense(documentId: string, draft: ExpenseDraft): Promise<InsertResult<Record<string, unknown>>>;
  getExpenseBySource(documentId: string): Promise<Record<string, unknown> | null>;
  deleteExpenseIfUnchanged(id: string, documentId: string, snapshot: Record<string, unknown>): Promise<boolean>;
  insertDriverDocument(doc: AutomationDocument, draft: ComplianceDraft): Promise<InsertResult<Record<string, unknown>>>;
  getDriverDocumentBySource(documentId: string): Promise<Record<string, unknown> | null>;
  deleteDriverDocumentIfUnchanged(id: string, documentId: string, snapshot: Record<string, unknown>): Promise<boolean>;
  /** Documents of this account waiting in review (newest first), for re-matching after a load appears. */
  listWaitingDocuments(limit: number): Promise<AutomationDocument[]>;
  /** True when the document is on a line of an approved/paid settlement. Throws when the check can't be completed. */
  documentInFinalizedSettlement(documentId: string): Promise<boolean>;
  log(entityId: string, action: string, metadata: Record<string, unknown>): Promise<void>;
}

export type ProcessOutcome =
  | { state: "auto_routed"; routing: RoutingRecord }
  | { state: "needs_review"; routing: RoutingRecord }
  | { state: "failed"; message: string }
  | { state: "busy" }
  | { state: "skipped"; reason: "not_found" | "dismissed" | "duplicate" | "already_routed" | "not_v2" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString();

function event(repo: DocumentRepo, by: RoutingEvent["by"], name: string, detail?: string): RoutingEvent {
  return { at: iso(repo.now()), by, event: name, ...(detail ? { detail: detail.slice(0, 300) } : {}) };
}

// -----------------------------------------------------------------------------
//  Gather candidates, then decide (no writes)
// -----------------------------------------------------------------------------

export interface DecideOverrides {
  corrections?: Record<string, string | number | boolean> | null;
  chosenLoadId?: string | null;
  chosenDriverId?: string | null;
}

export async function computeDecision(
  repo: DocumentRepo,
  doc: AutomationDocument,
  overrides: DecideOverrides = {},
): Promise<Decision> {
  const corrections = overrides.corrections ?? doc.routing?.corrections ?? null;
  const { extraction, parseFailed, typeHint } = effectiveExtraction(doc.extracted_data, corrections);
  const f = extraction.fields as Record<string, unknown>;
  const group = DOCUMENT_TYPE_GROUP[extraction.document_type];

  const identifiers = [normalizeIdentifier(f.load_number), normalizeIdentifier(f.bol_number)]
    .filter((x): x is string => !!x);
  const needLoads = group === "load" || group === "load_paperwork" || group === "expense";
  const loads = needLoads && identifiers.length ? await repo.findLoadCandidates(identifiers) : [];

  const ownLoad = async (id: string | null) => {
    if (!id) return null;
    const l = await repo.getLoad(id);
    return l && l.profile_id === repo.ownerId ? l : null;
  };
  const selectedLoad = await ownLoad(doc.load_id);
  const chosen = await ownLoad(overrides.chosenLoadId ?? null);
  const allLoads = chosen && !loads.some((l) => l.id === chosen.id) ? [...loads, chosen] : loads;

  const loadIds = Array.from(new Set([...allLoads.map((l) => l.id), ...(selectedLoad ? [selectedLoad.id] : [])]));
  const protectedIds = group === "expense" && loadIds.length ? await repo.protectedLoadIds(loadIds) : new Set<string>();
  const drivers = group === "driver" ? await repo.listDrivers() : [];
  const amount = typeof f.expense_amount === "number" ? f.expense_amount : null;
  const date = typeof f.receipt_date === "string" ? f.receipt_date : null;
  const similar = group === "expense" && amount !== null && date !== null
    ? await repo.findSimilarExpenses(amount, date)
    : [];

  return decideRouting({
    documentId: doc.id,
    ownerId: repo.ownerId,
    extraction,
    parseFailed,
    typeHint,
    humanCorrected: !!corrections && Object.keys(corrections).length > 0,
    selectedLoad,
    loads: allLoads,
    protectedLoadIds: protectedIds,
    drivers,
    chosenDriverId: overrides.chosenDriverId ?? null,
    chosenLoadId: overrides.chosenLoadId ?? null,
    similarExpenses: similar,
    duplicateOf: doc.duplicate_of,
    today: ymd(repo.now()),
  });
}

function newRecord(repo: DocumentRepo, d: Decision, prev: RoutingRecord | null, ev: RoutingEvent): RoutingRecord {
  return {
    version: 1,
    decided_at: iso(repo.now()),
    ...d,
    applied: prev?.applied ?? [],
    ...(prev?.corrections ? { corrections: prev.corrections } : {}),
    history: [...(prev?.history ?? []), ev].slice(-50),
  };
}

// -----------------------------------------------------------------------------
//  Executor — applies ONE proposal; never throws for expected conflicts
// -----------------------------------------------------------------------------

type ApplyResult = { ok: true; action: AppliedAction } | { ok: false; reason: ReviewReason; detail: string };

const expenseSnapshot = (r: Record<string, unknown>) => ({
  id: r.id,
  category: r.category,
  amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
  vendor_name: r.vendor_name ?? null,
  receipt_date: r.receipt_date ?? null,
  description: r.description ?? null,
  load_id: r.load_id ?? null,
});

const complianceSnapshot = (r: Record<string, unknown>) => ({
  id: r.id,
  driver_id: r.driver_id ?? null,
  document_kind: r.document_kind ?? null,
  title: r.title ?? null,
  issue_date: r.issue_date ?? null,
  expiration_date: r.expiration_date ?? null,
});

export async function applyProposal(
  repo: DocumentRepo,
  doc: AutomationDocument,
  p: ProposedAction,
  mode: AppliedAction["mode"],
): Promise<ApplyResult> {
  const at = iso(repo.now());
  if (doc.profile_id !== repo.ownerId) return { ok: false, reason: "apply_failed", detail: "not_owner" };

  switch (p.kind) {
    case "attach_load": {
      const load = await repo.getLoad(p.load_id);
      if (!load || load.profile_id !== repo.ownerId) {
        return { ok: false, reason: "load_not_found", detail: "load not in this account" };
      }
      if (doc.load_id && doc.load_id !== load.id) {
        return { ok: false, reason: "load_conflicts_selection", detail: "document already linked to another load" };
      }
      const ok = doc.load_id === load.id ? true : await repo.setDocumentLoad(doc.id, load.id, null);
      if (!ok) return { ok: false, reason: "apply_failed", detail: "document changed concurrently" };
      return {
        ok: true,
        action: {
          kind: "attach_load",
          target_table: "documents",
          target_id: doc.id,
          mode,
          applied_at: at,
          before: { load_id: doc.load_id },
          after: { load_id: load.id, load_number: load.load_number },
        },
      };
    }
    case "create_expense": {
      const d = p.expense;
      if (!(d.amount > 0) || !d.receipt_date) return { ok: false, reason: "expense_invalid", detail: "amount/date" };
      if (d.load_id) {
        const load = await repo.getLoad(d.load_id);
        if (!load || load.profile_id !== repo.ownerId) return { ok: false, reason: "load_not_found", detail: "load" };
        const prot = await repo.protectedLoadIds([d.load_id]);
        if (prot.has(d.load_id)) return { ok: false, reason: "load_protected", detail: "load settled/paid" };
      }
      const res = await repo.insertExpense(doc.id, d);
      let row: Record<string, unknown> | null = res.ok ? res.row : null;
      if (!res.ok) {
        if (res.code === "protected") return { ok: false, reason: "load_protected", detail: res.message };
        if (res.code !== "unique") return { ok: false, reason: "apply_failed", detail: res.message };
        row = await repo.getExpenseBySource(doc.id); // already created by an earlier run
        if (!row) return { ok: false, reason: "apply_failed", detail: "unique violation without row" };
      }
      return {
        ok: true,
        action: {
          kind: "create_expense",
          target_table: "expenses",
          target_id: String(row!.id),
          mode,
          applied_at: at,
          before: null,
          after: expenseSnapshot(row!),
        },
      };
    }
    case "attach_driver_document": {
      const drivers = await repo.listDrivers();
      const drv = drivers.find((x) => x.id === p.compliance.driver_id && x.profile_id === repo.ownerId);
      if (!drv) return { ok: false, reason: "no_driver_match", detail: "driver not on roster" };
      const res = await repo.insertDriverDocument(doc, p.compliance);
      let row: Record<string, unknown> | null = res.ok ? res.row : null;
      if (!res.ok) {
        if (res.code !== "unique") return { ok: false, reason: "apply_failed", detail: res.message };
        row = await repo.getDriverDocumentBySource(doc.id);
        if (!row) return { ok: false, reason: "apply_failed", detail: "unique violation without row" };
      }
      return {
        ok: true,
        action: {
          kind: "attach_driver_document",
          target_table: "compliance_documents",
          target_id: String(row!.id),
          mode,
          applied_at: at,
          before: null,
          after: complianceSnapshot(row!),
        },
      };
    }
    case "create_load":
      // Loads are only ever created by the explicit "Create load" form.
      return { ok: false, reason: "rate_con_no_load", detail: "create_load requires the explicit form" };
  }
}

const liveActions = (r: RoutingRecord | null) => (r?.applied ?? []).filter((a) => !a.undone_at);

function alreadyApplied(r: RoutingRecord | null, p: ProposedAction): boolean {
  return liveActions(r).some((a) => a.kind === p.kind);
}

// -----------------------------------------------------------------------------
//  Main entry: process one document (upload trigger / retry)
// -----------------------------------------------------------------------------

export async function processDocument(repo: DocumentRepo, documentId: string): Promise<ProcessOutcome> {
  let doc = await repo.getDocument(documentId);
  if (!doc || doc.profile_id !== repo.ownerId) return { state: "skipped", reason: "not_found" };
  if (doc.review_status === "dismissed") return { state: "skipped", reason: "dismissed" };
  if (doc.review_status !== null) return { state: "skipped", reason: "already_routed" };
  if (doc.duplicate_of) return { state: "skipped", reason: "duplicate" };

  // Rows produced by the iPhone (v1) or entered manually are never re-read
  // here; the pending-document backfill is a separate, dry-run-first tool.
  if ((doc.status === "processed" || doc.status === "manual") && !isRoutableVersion(doc.extraction_version)) {
    return { state: "skipped", reason: "not_v2" };
  }
  const needsExtraction = !(doc.status === "processed" && isRoutableVersion(doc.extraction_version));
  if (needsExtraction) {
    const stale = new Date(repo.now().getTime() - STALE_PROCESSING_MS).toISOString();
    if (!(await repo.claimExtraction(doc.id, stale))) return { state: "busy" };
    const hint = doc.document_type ? routableDocumentType(doc.document_type) : null;
    const res = await repo.invokeExtractor(doc.id, hint && hint !== "other" ? hint : null);
    if (!res.ok) {
      const message = res.message ?? res.code ?? "extraction failed";
      await repo.markExtractionFailed(doc.id, message);
      return { state: "failed", message };
    }
    doc = await repo.getDocument(documentId);
    if (!doc || doc.status !== "processed" || !isRoutableVersion(doc.extraction_version)) {
      return { state: "failed", message: "extraction did not complete" };
    }
  }
  return routeDocument(repo, doc);
}

export async function routeDocument(repo: DocumentRepo, doc: AutomationDocument): Promise<ProcessOutcome> {
  if (doc.review_status !== null) return { state: "skipped", reason: "already_routed" };
  if (!isRoutableVersion(doc.extraction_version)) return { state: "skipped", reason: "not_v2" };
  const decision = await computeDecision(repo, doc);
  const record = newRecord(repo, decision, doc.routing, event(repo, "automation", "decided", decision.decision));

  // Claim the routing decision exactly once.
  if (!(await repo.claimRouting(doc.id, "needs_review", record))) {
    return { state: "skipped", reason: "already_routed" };
  }
  if (decision.decision !== "auto" || !decision.proposed) {
    await repo.log(doc.id, "needs_review", { label: "Document needs review", reasons: record.reasons, type: record.type });
    return { state: "needs_review", routing: record };
  }

  const res = await applyProposal(repo, doc, decision.proposed, "automatic");
  if (!res.ok) {
    record.decision = "review";
    record.reasons = [res.reason];
    record.history.push(event(repo, "automation", "apply_failed", res.detail));
    await repo.saveRouting(doc.id, "needs_review", record, false);
    return { state: "needs_review", routing: record };
  }
  record.applied = [...record.applied, res.action];
  record.history.push(event(repo, "automation", `applied:${res.action.kind}`, res.action.target_id));
  await repo.saveRouting(doc.id, "auto_routed", record, false);
  await repo.log(doc.id, "auto_routed", {
    label: `Document auto-routed: ${res.action.kind.replace(/_/g, " ")}`,
    document_id: doc.id,
    action: res.action.kind,
    target_table: res.action.target_table,
    target_id: res.action.target_id,
    confidence: { classification: record.classification.score, match: record.match?.score ?? null },
    mode: "automatic",
  });
  return { state: "auto_routed", routing: record };
}

// -----------------------------------------------------------------------------
//  Human review operations
// -----------------------------------------------------------------------------

export type ReviewResult = { ok: true; routing: RoutingRecord } | { ok: false; error: string };

async function reviewable(repo: DocumentRepo, id: string): Promise<AutomationDocument | { error: string }> {
  const doc = await repo.getDocument(id);
  if (!doc || doc.profile_id !== repo.ownerId) return { error: "Document not found." };
  return doc;
}

/** Re-decide with human corrections / choices. Never applies anything. */
export async function reviseDocument(
  repo: DocumentRepo,
  id: string,
  input: { type?: string | null; corrections?: Record<string, string | number | boolean>; loadId?: string | null; driverId?: string | null },
): Promise<ReviewResult> {
  const d = await reviewable(repo, id);
  if ("error" in d) return { ok: false, error: d.error };
  if (d.review_status !== "needs_review") return { ok: false, error: "Only documents waiting for review can be changed." };
  const corrections: Record<string, string | number | boolean> = { ...(d.routing?.corrections ?? {}), ...(input.corrections ?? {}) };
  if (input.type) {
    if (!isCanonicalDocumentType(input.type)) return { ok: false, error: "Unknown document type." };
    corrections.document_type = input.type;
  }
  const decision = await computeDecision(repo, d, {
    corrections,
    chosenLoadId: input.loadId ?? null,
    chosenDriverId: input.driverId ?? null,
  });
  const record = newRecord(repo, { ...decision, decision: "review" }, d.routing, event(repo, "user", "revised"));
  record.corrections = corrections;
  await repo.saveRouting(d.id, "needs_review", record, true);
  return { ok: true, routing: record };
}

/** Apply the current proposal after a human looked at it. */
export async function approveDocument(repo: DocumentRepo, id: string): Promise<ReviewResult> {
  const d = await reviewable(repo, id);
  if ("error" in d) return { ok: false, error: d.error };
  if (d.review_status !== "needs_review" || !d.routing) return { ok: false, error: "Nothing to approve." };
  const p = d.routing.proposed;
  if (!p) return { ok: false, error: "There is no proposed action. Choose a load or driver first." };
  if (p.kind === "create_load") return { ok: false, error: "Use Create load to add this load." };
  if (alreadyApplied(d.routing, p)) return { ok: false, error: "This action was already applied." };
  // Guards are re-evaluated at approval time (records may have changed).
  const fresh = await computeDecision(repo, d, {
    corrections: d.routing.corrections ?? null,
    chosenLoadId: p.kind === "attach_load" ? p.load_id : p.kind === "create_expense" ? p.expense.load_id : null,
    chosenDriverId: p.kind === "attach_driver_document" ? p.compliance.driver_id : null,
  });
  const blocking: ReviewReason[] = ["load_protected", "driver_conflict", "load_conflicts_selection"];
  const hit = fresh.reasons.find((r) => blocking.includes(r));
  if (hit) return { ok: false, error: `Can't approve: ${hit.replace(/_/g, " ")}.` };
  const res = await applyProposal(repo, d, p, "human_approved");
  const record: RoutingRecord = { ...d.routing, history: [...d.routing.history] };
  if (!res.ok) {
    record.history.push(event(repo, "user", "approve_failed", res.detail));
    await repo.saveRouting(d.id, "needs_review", record, true);
    return { ok: false, error: `Could not apply: ${res.reason.replace(/_/g, " ")}.` };
  }
  record.applied = [...record.applied, res.action];
  record.history.push(event(repo, "user", `approved:${res.action.kind}`, res.action.target_id));
  await repo.saveRouting(d.id, "approved", record, true);
  await repo.log(d.id, "approved", {
    label: `Document approved: ${res.action.kind.replace(/_/g, " ")}`,
    document_id: d.id,
    action: res.action.kind,
    target_id: res.action.target_id,
    mode: "human_approved",
  });
  return { ok: true, routing: record };
}

export async function dismissDocument(repo: DocumentRepo, id: string): Promise<ReviewResult> {
  const d = await reviewable(repo, id);
  if ("error" in d) return { ok: false, error: d.error };
  if (d.review_status !== "needs_review" && d.review_status !== null) {
    return { ok: false, error: "Only documents waiting for review can be dismissed." };
  }
  const base = d.routing ?? newRecord(repo, {
    type: routableDocumentType(d.document_type),
    classification: { score: 0, band: "low", model_confidence: null, missing_required: [], rejected_keys: [] },
    match: null,
    decision: "review",
    reasons: [],
    proposed: null,
  }, null, event(repo, "user", "created"));
  const record: RoutingRecord = { ...base, history: [...base.history, event(repo, "user", "dismissed")] };
  await repo.saveRouting(d.id, "dismissed", record, true);
  await repo.log(d.id, "dismissed", { label: "Document dismissed from review", document_id: d.id });
  return { ok: true, routing: record };
}

/** Re-run extraction. Refused while any applied action is still live. */
export async function retryDocument(repo: DocumentRepo, id: string): Promise<ProcessOutcome | { state: "refused"; message: string }> {
  const d = await reviewable(repo, id);
  if ("error" in d) return { state: "refused", message: d.error };
  if (liveActions(d.routing).length > 0) {
    return { state: "refused", message: "Undo the applied action before extracting again." };
  }
  if (d.review_status !== null && d.review_status !== "needs_review") {
    return { state: "refused", message: "Only failed or review documents can be retried." };
  }
  const record = d.routing
    ? { ...d.routing, history: [...d.routing.history, event(repo, "user", "retry")] }
    : null;
  if (!(await repo.resetForRetry(d.id, record))) return { state: "busy" };
  return processDocument(repo, id);
}

export type UndoResult = { ok: true } | { ok: false; error: string };

/** Undo one applied action, only if the target is unchanged since it was applied. */
export async function undoAction(repo: DocumentRepo, id: string, index: number): Promise<UndoResult> {
  const d = await reviewable(repo, id);
  if ("error" in d) return { ok: false, error: d.error };
  const a = d.routing?.applied?.[index];
  if (!d.routing || !a) return { ok: false, error: "Action not found." };
  if (a.undone_at) return { ok: false, error: "Already undone." };

  if (a.kind === "attach_load") {
    // A document already turned into a settlement line stays with its load.
    if (d.settlement_id) {
      return { ok: false, error: "This document is on a settlement. Remove the load from that settlement first; nothing undone." };
    }
    // Fail closed: if the settlement check can't run, nothing is undone.
    let finalized: boolean;
    try {
      finalized = await repo.documentInFinalizedSettlement(d.id);
    } catch {
      return { ok: false, error: "Couldn't verify the document's settlement status; nothing undone. Try again." };
    }
    if (finalized) {
      return { ok: false, error: "This document is part of an approved/paid settlement." };
    }
    const after = a.after.load_id as string;
    if (d.load_id !== after) return { ok: false, error: "The document's load changed since; nothing undone." };
    const ok = await repo.setDocumentLoad(d.id, (a.before?.load_id as string | null) ?? null, after);
    if (!ok) return { ok: false, error: "The document changed concurrently; nothing undone." };
  } else if (a.kind === "create_expense") {
    const loadId = a.after.load_id as string | null;
    if (loadId && (await repo.protectedLoadIds([loadId])).has(loadId)) {
      return { ok: false, error: "The expense's load is settled or paid; it can't be undone here." };
    }
    if (!(await repo.deleteExpenseIfUnchanged(a.target_id, d.id, a.after))) {
      return { ok: false, error: "The expense was edited after it was created; nothing undone." };
    }
  } else if (a.kind === "attach_driver_document") {
    if (!(await repo.deleteDriverDocumentIfUnchanged(a.target_id, d.id, a.after))) {
      return { ok: false, error: "The driver document was edited after it was created; nothing undone." };
    }
  } else {
    return { ok: false, error: "This action can't be undone here." };
  }

  const applied = d.routing.applied.map((x, i) => (i === index ? { ...x, undone_at: iso(repo.now()) } : x));
  const record: RoutingRecord = {
    ...d.routing,
    applied,
    decision: "review",
    reasons: ["undone"],
    history: [...d.routing.history, event(repo, "user", `undone:${a.kind}`, a.target_id)],
  };
  await repo.saveRouting(d.id, "needs_review", record, true);
  await repo.log(d.id, "undone", { label: `Document action undone: ${a.kind.replace(/_/g, " ")}`, document_id: d.id, target_id: a.target_id });
  return { ok: true };
}

// -----------------------------------------------------------------------------
//  Documents that arrived before their load (out-of-order uploads)
// -----------------------------------------------------------------------------

/** Review reasons that only mean "the load wasn't there yet". */
const WAITING_FOR_LOAD: ReadonlySet<ReviewReason> = new Set<ReviewReason>(["load_not_found", "no_load_identifier", "rate_con_no_load"]);

/**
 * After a load is created or a rate confirmation is filed, re-decide the
 * documents that were waiting ONLY because no load carried their number (a
 * BOL/POD/receipt uploaded before the rate con). Same rules as the first
 * pass: anything uncertain stays in review. Human-corrected documents are
 * never touched. Returns the ids that were filed automatically.
 */
export async function rerouteWaitingForLoad(repo: DocumentRepo, loadId: string): Promise<string[]> {
  const load = await repo.getLoad(loadId);
  if (!load || load.profile_id !== repo.ownerId) return [];
  const key = normalizeIdentifier(load.load_number);
  if (!key) return [];
  const filed: string[] = [];
  for (const doc of await repo.listWaitingDocuments(200)) {
    if (doc.profile_id !== repo.ownerId || doc.review_status !== "needs_review" || !doc.routing) continue;
    if (doc.duplicate_of || doc.load_id) continue;
    if (doc.routing.corrections && Object.keys(doc.routing.corrections).length > 0) continue;
    if (liveActions(doc.routing).length > 0) continue;
    const reasons = doc.routing.reasons ?? [];
    if (reasons.length === 0 || !reasons.every((r) => WAITING_FOR_LOAD.has(r))) continue;
    const { extraction } = effectiveExtraction(doc.extracted_data, null);
    const f = extraction.fields as Record<string, unknown>;
    const ids = [normalizeIdentifier(f.load_number), normalizeIdentifier(f.bol_number)];
    if (!ids.includes(key)) continue;

    const decision = await computeDecision(repo, doc);
    const record = newRecord(repo, decision, doc.routing, event(repo, "automation", "rematched_after_load", decision.decision));
    if (decision.decision !== "auto" || !decision.proposed) {
      await repo.saveRouting(doc.id, "needs_review", record, false);
      continue;
    }
    const res = await applyProposal(repo, doc, decision.proposed, "automatic");
    if (!res.ok) {
      record.decision = "review";
      record.reasons = [res.reason];
      record.history.push(event(repo, "automation", "apply_failed", res.detail));
      await repo.saveRouting(doc.id, "needs_review", record, false);
      continue;
    }
    record.applied = [...record.applied, res.action];
    record.history.push(event(repo, "automation", `applied:${res.action.kind}`, res.action.target_id));
    await repo.saveRouting(doc.id, "auto_routed", record, false);
    await repo.log(doc.id, "auto_routed", {
      label: `Document filed after its load appeared: ${res.action.kind.replace(/_/g, " ")}`,
      document_id: doc.id, action: res.action.kind, target_table: res.action.target_table, target_id: res.action.target_id, mode: "automatic",
    });
    filed.push(doc.id);
  }
  return filed;
}
