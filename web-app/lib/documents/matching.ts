// =============================================================================
//  Document automation — entity matching (pure, deterministic)
// -----------------------------------------------------------------------------
//  No fuzzy string distance anywhere: identifiers must be EXACT after
//  normalisation, names must be the SAME token set. Everything that is not
//  exact goes to human review.
// =============================================================================

import {
  DATE_TOLERANCE_DAYS,
  DRIVER_MATCH,
  LOAD_MATCH,
  RECEIPT_LOAD_WINDOW_DAYS,
} from "./confidence";
import type { DriverCandidate, ExpenseSimilar, LoadCandidate, MatchResult } from "./types";

/** "Load # RC-1001" / "rc 1001" -> "RC1001". Null when too short to trust. */
export function normalizeIdentifier(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= 3 ? s : null;
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** "HINTON, DEMARQUIS L." -> "demarquis hinton" (sorted token set). */
export function normalizePersonName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const tokens = v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_SUFFIXES.has(t));
  if (tokens.length < 2) return null;
  return Array.from(new Set(tokens)).sort().join(" ");
}

const COMPANY_STOP = new Set([
  "llc", "inc", "co", "corp", "corporation", "company", "ltd", "the", "and",
  "logistics", "transport", "transportation", "freight", "services", "group",
]);

export function companyTokens(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !COMPANY_STOP.has(t));
}

/** Broker names corroborate when every distinctive token of the shorter name appears in the other. */
export function companiesCorroborate(a: unknown, b: unknown): boolean {
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return short.every((t) => long.has(t));
}

/** "Dallas, TX" -> "dallas". */
export function cityOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const city = v.split(",")[0].toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  return city.length >= 3 ? city : null;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86_400_000;
}

export function datesCorroborate(docDate: unknown, loadDate: string | null): boolean {
  return typeof docDate === "string" && !!loadDate && dayDiff(docDate, loadDate) <= DATE_TOLERANCE_DAYS;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Loads whose normalised load_number equals one of the document's identifiers. */
export function loadsWithIdentifier(
  loads: readonly LoadCandidate[],
  identifiers: readonly (string | null)[],
): LoadCandidate[] {
  const ids = new Set(identifiers.filter((x): x is string => !!x));
  return loads.filter((l) => {
    const n = normalizeIdentifier(l.load_number);
    return n !== null && ids.has(n);
  });
}

export interface LoadMatchInput {
  identifiers: readonly (string | null)[]; // normalised
  broker_name?: unknown;
  dates?: readonly unknown[];
  cities?: readonly unknown[];
  /** Receipt date: corroborates when inside the load's window. */
  receipt_date?: unknown;
}

export function matchLoad(
  ownerId: string,
  loads: readonly LoadCandidate[],
  input: LoadMatchInput,
): MatchResult {
  const usable = input.identifiers.filter((x): x is string => !!x);
  if (usable.length === 0) {
    return { kind: "load", score: 0, target_id: null, candidate_ids: [], evidence: ["no_identifier"] };
  }
  // Defence in depth: never consider a row of another account, whatever the query returned.
  const own = loads.filter((l) => l.profile_id === ownerId);
  const hits = loadsWithIdentifier(own, usable);
  if (hits.length === 0) {
    return { kind: "load", score: 0, target_id: null, candidate_ids: [], evidence: ["not_found"] };
  }
  if (hits.length > 1) {
    return {
      kind: "load",
      score: 0,
      target_id: null,
      candidate_ids: hits.map((h) => h.id),
      evidence: ["ambiguous"],
    };
  }
  const load = hits[0];
  let score = LOAD_MATCH.exactUniqueNumber;
  const evidence = ["load_number"];
  if (input.broker_name && companiesCorroborate(input.broker_name, load.broker_name)) {
    score += LOAD_MATCH.broker;
    evidence.push("broker");
  }
  const dates = input.dates ?? [];
  if (dates.some((d) => datesCorroborate(d, load.pickup_date) || datesCorroborate(d, load.delivery_date))) {
    score += LOAD_MATCH.date;
    evidence.push("date");
  }
  if (typeof input.receipt_date === "string") {
    const start = load.pickup_date ?? load.delivery_date;
    const end = load.delivery_date ?? load.pickup_date;
    if (
      start && end &&
      input.receipt_date >= addDays(start, -RECEIPT_LOAD_WINDOW_DAYS) &&
      input.receipt_date <= addDays(end, RECEIPT_LOAD_WINDOW_DAYS)
    ) {
      score += LOAD_MATCH.date;
      evidence.push("receipt_in_load_window");
    }
  }
  const loadCities = [cityOf(load.origin), cityOf(load.destination)].filter(Boolean);
  if ((input.cities ?? []).some((c) => { const n = cityOf(c); return n !== null && loadCities.includes(n); })) {
    score += LOAD_MATCH.city;
    evidence.push("city");
  }
  return {
    kind: "load",
    score: Math.min(1, Math.round(score * 100) / 100),
    target_id: load.id,
    candidate_ids: [load.id],
    evidence,
  };
}

export interface DriverMatchInput {
  person_name: unknown;
  license_number?: unknown;
  license_state?: unknown;
}

export function matchDriver(
  ownerId: string,
  drivers: readonly DriverCandidate[],
  input: DriverMatchInput,
): MatchResult {
  const own = drivers.filter((d) => d.profile_id === ownerId);
  const name = normalizePersonName(input.person_name);
  const lic = normalizeIdentifier(input.license_number);
  const byName = name ? own.filter((d) => normalizePersonName(d.name) === name) : [];
  const byLicense = lic ? own.filter((d) => normalizeIdentifier(d.cdl_number) === lic) : [];

  if (byLicense.length === 1 && byName.length >= 1 && !byName.some((d) => d.id === byLicense[0].id)) {
    return {
      kind: "driver",
      score: 0,
      target_id: null,
      candidate_ids: [byLicense[0].id, ...byName.map((d) => d.id)],
      evidence: ["conflict"],
    };
  }
  if (byName.length > 1) {
    // Same name twice: only a license number can tell them apart.
    if (byLicense.length === 1 && byName.some((d) => d.id === byLicense[0].id)) {
      return {
        kind: "driver",
        score: 1,
        target_id: byLicense[0].id,
        candidate_ids: byName.map((d) => d.id),
        evidence: ["name", "license"],
      };
    }
    return { kind: "driver", score: 0, target_id: null, candidate_ids: byName.map((d) => d.id), evidence: ["ambiguous"] };
  }
  if (byName.length === 0) {
    if (byLicense.length === 1) {
      // License matches but the printed name does not: never route on that alone.
      return { kind: "driver", score: 0, target_id: null, candidate_ids: [byLicense[0].id], evidence: ["conflict"] };
    }
    return { kind: "driver", score: 0, target_id: null, candidate_ids: [], evidence: ["not_found"] };
  }
  const d = byName[0];
  let score = DRIVER_MATCH.exactUniqueName;
  const evidence = ["name"];
  if (lic && normalizeIdentifier(d.cdl_number) === lic) {
    score += DRIVER_MATCH.license;
    evidence.push("license");
  }
  return { kind: "driver", score: Math.min(1, score), target_id: d.id, candidate_ids: [d.id], evidence };
}

/** Existing expense with the same amount (to the cent) and date, and a vendor that is not clearly different. */
export function findPossibleDuplicateExpense(
  existing: readonly ExpenseSimilar[],
  draft: { amount: number; receipt_date: string; vendor_name: string | null },
  documentId: string,
): ExpenseSimilar | null {
  const cents = Math.round(draft.amount * 100);
  const vendor = companyTokens(draft.vendor_name ?? "");
  for (const e of existing) {
    if (e.source_document_id === documentId) continue; // ours (idempotent re-run)
    if (Math.round(Number(e.amount) * 100) !== cents) continue;
    if (e.receipt_date !== draft.receipt_date) continue;
    // Same amount to the cent on the same date is already strong evidence:
    // err towards review unless the vendors clearly differ (no shared word,
    // store numbers like "#452" ignored).
    const words = (t: string[]) => t.filter((w) => !/^\d+$/.test(w));
    const a = new Set(words(vendor));
    const b = words(companyTokens(e.vendor_name ?? ""));
    if (a.size === 0 || b.length === 0 || b.some((w) => a.has(w))) {
      return e;
    }
  }
  return null;
}
