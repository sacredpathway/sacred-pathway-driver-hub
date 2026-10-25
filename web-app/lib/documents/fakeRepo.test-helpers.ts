// In-memory DocumentRepo for tests. Mirrors the database rules that matter:
// owner isolation, conditional claims, UNIQUE source_document_id on
// expenses / driver documents, and the protected-load expense guard.

import type { DocumentRepo, ExtractorResult, InsertResult } from "./pipeline";
import { sanitizeExtraction } from "./extraction";
import { sanitizePayrollExtraction } from "./payrollExtraction";
import type {
  AutomationDocument,
  ComplianceDraft,
  DriverCandidate,
  ExpenseDraft,
  LoadCandidate,
  ReviewStatus,
  RoutingRecord,
} from "./types";
import { snapshotMatches } from "./repo";

export const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
export const OTHER = "bbbbbbbb-0000-4000-8000-000000000001";

export interface FakeState {
  docs: Map<string, AutomationDocument>;
  loads: LoadCandidate[];
  drivers: DriverCandidate[];
  expenses: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  /** loads paid by an issued paystub / approved settlement */
  paidLoads: Set<string>;
  finalizedSettlementDocs: Set<string>;
  /** status of the settlement whose line references the document (rate con / POD) */
  settlementStatusByDoc: Map<string, string>;
  /** when set, documentInFinalizedSettlement fails like a query error */
  settlementCheckError: string | null;
  logs: Array<{ entityId: string; action: string; metadata: Record<string, unknown> }>;
  extractorCalls: Array<{ id: string; hint: string | null }>;
  /** What the "Edge Function" returns for a document id (raw model JSON). */
  modelOutput: Map<string, unknown>;
  extractorFails: Map<string, string>;
  /** when true the fake "Edge Function" answers with the v3 payroll profile */
  v3?: boolean;
}

export function newState(): FakeState {
  return {
    docs: new Map(),
    loads: [],
    drivers: [],
    expenses: [],
    compliance: [],
    paidLoads: new Set(),
    finalizedSettlementDocs: new Set(),
    settlementStatusByDoc: new Map(),
    settlementCheckError: null,
    logs: [],
    extractorCalls: [],
    modelOutput: new Map(),
    extractorFails: new Map(),
  };
}

let seq = 0;
export const uid = (prefix = "c") =>
  `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function addDoc(st: FakeState, patch: Partial<AutomationDocument> = {}): AutomationDocument {
  const id = patch.id ?? uid("d");
  const doc: AutomationDocument = {
    id,
    profile_id: OWNER,
    load_id: null,
    document_type: null,
    storage_path: `${OWNER}/${id}.pdf`,
    status: "pending",
    extracted_data: null,
    extraction_version: null,
    review_status: null,
    routing: null,
    duplicate_of: null,
    content_sha256: null,
    source: "web",
    updated_at: "2026-10-01T00:00:00.000Z",
    error_message: null,
    ...patch,
  };
  st.docs.set(id, doc);
  return doc;
}

export function addLoad(st: FakeState, patch: Partial<LoadCandidate> = {}): LoadCandidate {
  const l: LoadCandidate = {
    id: uid("l"),
    profile_id: OWNER,
    load_number: null,
    broker_name: null,
    pickup_date: null,
    delivery_date: null,
    origin: null,
    destination: null,
    total_revenue: null,
    status: "pending",
    ...patch,
  };
  st.loads.push(l);
  return l;
}

export function addDriver(st: FakeState, patch: Partial<DriverCandidate> = {}): DriverCandidate {
  const d: DriverCandidate = {
    id: uid("r"),
    profile_id: OWNER,
    name: "Test Driver",
    cdl_number: null,
    cdl_state: null,
    active: true,
    ...patch,
  };
  st.drivers.push(d);
  return d;
}

/** Simulates the Edge Function v2 writing a sanitised extraction. */
export function storeExtraction(st: FakeState, id: string, raw: unknown, typeHint: string | null = null) {
  const doc = st.docs.get(id)!;
  const sanitized = sanitizeExtraction(raw);
  st.docs.set(id, {
    ...doc,
    status: "processed",
    extraction_version: "v2",
    document_type: sanitized.document_type,
    extracted_data: { ...sanitized, parse_stage: "strict", type_hint: typeHint },
  });
}

const PROTECTED_STATUS = new Set(["settled", "cancelled", "canceled"]);

export function createFakeRepo(st: FakeState, ownerId = OWNER, now = new Date("2026-10-01T12:00:00Z")): DocumentRepo {
  const own = <T extends { profile_id: unknown }>(r: T | undefined | null) => (r && r.profile_id === ownerId ? r : null);
  const isProtected = (id: string) => {
    const l = st.loads.find((x) => x.id === id);
    return !l || PROTECTED_STATUS.has(String(l.status)) || st.paidLoads.has(id);
  };
  return {
    ownerId,
    now: () => now,
    async getDocument(id) {
      const d = own(st.docs.get(id));
      return d ? structuredClone(d) : null;
    },
    async listWaitingDocuments(limit) {
      return [...st.docs.values()]
        .filter((d) => d.profile_id === ownerId && d.review_status === "needs_review" && d.load_id === null)
        .slice(0, limit).map((d) => structuredClone(d));
    },
    async claimExtraction(id, staleBeforeIso) {
      const d = own(st.docs.get(id));
      if (!d || d.review_status !== null) return false;
      const ok = d.status === "pending" || d.status === "failed" ||
        (d.status === "processing" && (d.updated_at ?? "") < staleBeforeIso);
      if (!ok) return false;
      st.docs.set(id, { ...d, status: "processing", updated_at: now.toISOString() });
      return true;
    },
    async invokeExtractor(id, hint): Promise<ExtractorResult> {
      st.extractorCalls.push({ id, hint });
      const fail = st.extractorFails.get(id);
      if (fail) {
        const d = st.docs.get(id)!;
        st.docs.set(id, { ...d, status: "failed", error_message: fail });
        return { ok: false, code: "UNKNOWN_SCAN_ERROR", message: fail };
      }
      if (st.v3) storeExtractionV3(st, id, toV3Raw(st.modelOutput.get(id) ?? {}), hint);
      else storeExtraction(st, id, st.modelOutput.get(id) ?? {}, hint);
      return { ok: true };
    },
    async markExtractionFailed(id, message) {
      const d = st.docs.get(id)!;
      if (d.status !== "processed") st.docs.set(id, { ...d, status: "failed", error_message: message });
    },
    async resetForRetry(id, routing) {
      const d = own(st.docs.get(id));
      if (!d || d.status === "processing" || !(d.review_status === null || d.review_status === "needs_review")) return false;
      st.docs.set(id, { ...d, status: "pending", review_status: null, routing, error_message: null });
      return true;
    },
    async findLoadCandidates() {
      // Return EVERYTHING (other accounts included) to prove the matcher filters by owner.
      return structuredClone(st.loads);
    },
    async getLoad(id) {
      return structuredClone(own(st.loads.find((l) => l.id === id)));
    },
    async protectedLoadIds(ids) {
      return new Set(ids.filter(isProtected));
    },
    async listDrivers() {
      return structuredClone(st.drivers.filter((d) => d.profile_id === ownerId));
    },
    async findSimilarExpenses(amount, date) {
      return st.expenses
        .filter((e) => e.profile_id === ownerId && e.receipt_date === date && Math.abs(Number(e.amount) - amount) < 0.005)
        .map((e) => ({
          id: String(e.id),
          amount: Number(e.amount),
          receipt_date: e.receipt_date as string,
          vendor_name: (e.vendor_name as string) ?? null,
          source_document_id: (e.source_document_id as string) ?? null,
        }));
    },
    async claimRouting(id, status: ReviewStatus, routing: RoutingRecord) {
      const d = own(st.docs.get(id));
      if (!d || d.review_status !== null) return false;
      st.docs.set(id, { ...d, review_status: status, routing: structuredClone(routing) });
      return true;
    },
    async saveRouting(id, status, routing) {
      const d = st.docs.get(id)!;
      st.docs.set(id, { ...d, review_status: status, routing: structuredClone(routing) });
    },
    async setDocumentLoad(id, loadId, expected) {
      const d = own(st.docs.get(id));
      if (!d || d.load_id !== expected) return false;
      st.docs.set(id, { ...d, load_id: loadId });
      return true;
    },
    async insertExpense(documentId, draft: ExpenseDraft): Promise<InsertResult<Record<string, unknown>>> {
      if (st.expenses.some((e) => e.source_document_id === documentId)) {
        return { ok: false, code: "unique", message: "duplicate key value violates unique constraint" };
      }
      if (draft.load_id && isProtected(draft.load_id)) {
        return { ok: false, code: "protected", message: "document_automation_load_protected" };
      }
      const row = { id: uid("e"), profile_id: ownerId, source_document_id: documentId, ...draft };
      st.expenses.push(row);
      return { ok: true, row: structuredClone(row) };
    },
    async getExpenseBySource(documentId) {
      const e = st.expenses.find((x) => x.source_document_id === documentId && x.profile_id === ownerId);
      return e ? structuredClone(e) : null;
    },
    async deleteExpenseIfUnchanged(id, documentId, snap) {
      const i = st.expenses.findIndex((x) => x.id === id && x.source_document_id === documentId && x.profile_id === ownerId);
      if (i < 0 || !snapshotMatches(st.expenses[i], snap, ["category", "amount", "vendor_name", "receipt_date", "description", "load_id"])) return false;
      st.expenses.splice(i, 1);
      return true;
    },
    async insertDriverDocument(doc, draft: ComplianceDraft) {
      if (st.compliance.some((c) => c.source_document_id === doc.id)) {
        return { ok: false, code: "unique", message: "duplicate key" };
      }
      const row = { id: uid("k"), profile_id: ownerId, source_document_id: doc.id, storage_path: doc.storage_path, ...draft };
      st.compliance.push(row);
      return { ok: true, row: structuredClone(row) };
    },
    async getDriverDocumentBySource(documentId) {
      const c = st.compliance.find((x) => x.source_document_id === documentId && x.profile_id === ownerId);
      return c ? structuredClone(c) : null;
    },
    async deleteDriverDocumentIfUnchanged(id, documentId, snap) {
      const i = st.compliance.findIndex((x) => x.id === id && x.source_document_id === documentId);
      if (i < 0 || !snapshotMatches(st.compliance[i], snap, ["driver_id", "document_kind", "title", "issue_date", "expiration_date"])) return false;
      st.compliance.splice(i, 1);
      return true;
    },
    async documentInFinalizedSettlement(documentId) {
      if (st.settlementCheckError) throw new Error(st.settlementCheckError);
      const status = st.settlementStatusByDoc.get(documentId);
      return st.finalizedSettlementDocs.has(documentId) || status === "approved" || status === "paid";
    },
    async log(entityId, action, metadata) {
      st.logs.push({ entityId, action, metadata });
    },
  };
}

// ----------------------------------------------------------- model outputs --

/** Flat v2-style model JSON -> v3 shape ({value, page, source_text, confidence} per field). */
export function toV3Raw(flat: unknown): Record<string, unknown> {
  const o = (flat && typeof flat === "object" ? flat : {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "document_type" || k === "confidence" || k === "notes") continue;
    fields[k] = { value: v, page: 1, source_text: String(v), confidence: o.confidence ?? "high" };
  }
  return { document_type: o.document_type, confidence: o.confidence, page_count: 1, fields, notes: o.notes ?? "" };
}

/** Simulates Edge Function v22 writing a v3 (payroll profile) extraction. */
export function storeExtractionV3(st: FakeState, id: string, raw: unknown, typeHint: string | null = null) {
  const doc = st.docs.get(id)!;
  const s = sanitizePayrollExtraction(raw);
  st.docs.set(id, {
    ...doc,
    status: "processed",
    extraction_version: "v3",
    document_type: s.stored_document_type,
    extracted_data: { ...s, parse_stage: "strict", type_hint: typeHint },
  });
}

export const RATE_CON = (over: Record<string, unknown> = {}) => ({
  document_type: "rate_confirmation",
  confidence: "high",
  load_number: "RC-1001",
  broker_name: "TQL Logistics",
  pickup_date: "2026-09-28",
  delivery_date: "2026-09-30",
  origin: "Dallas, TX",
  destination: "Atlanta, GA",
  total_miles: 780,
  total_revenue: 2400,
  ...over,
});

export const FUEL = (over: Record<string, unknown> = {}) => ({
  document_type: "fuel_receipt",
  confidence: "high",
  vendor_name: "Pilot #452",
  expense_amount: 412.18,
  receipt_date: "2026-09-29",
  gallons: 101.2,
  price_per_gallon: 4.073,
  ...over,
});

export const CDL = (over: Record<string, unknown> = {}) => ({
  document_type: "cdl",
  confidence: "high",
  person_name: "HINTON, DEMARQUIS",
  license_number: "D1234567",
  license_state: "NM",
  expiration_date: "2029-04-30",
  ...over,
});
