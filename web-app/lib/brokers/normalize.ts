// Exact port of iOS `Broker.normalize(_:)` (SacredPathway/Models/Broker.swift)
// so the web finds the SAME `brokers.normalized_name` row iOS created and
// never makes a duplicate broker. Keep the two in lockstep.

const ALIASES: Record<string, string> = {
  tql: "total quality logistics",
  "ch robinson": "c.h. robinson",
  chr: "c.h. robinson",
  "c h robinson": "c.h. robinson",
  "jb hunt": "j.b. hunt",
  "j b hunt": "j.b. hunt",
  xpo: "xpo logistics",
  schneider: "schneider national",
  landstar: "landstar system",
  echo: "echo global logistics",
  coyote: "coyote logistics",
};

// Same order as Swift; each suffix is stripped at most once, in sequence.
const SUFFIXES = [
  " inc", " inc.", " llc", " llc.", " corp", " corp.", " co", " co.",
  " ltd", " ltd.", " logistics", " transportation", " transport",
  " freight", " trucking",
];

export function normalizeBrokerName(name: string): string {
  const lowered = name.toLowerCase().trim();
  const mapped = ALIASES[lowered];
  if (mapped) return mapped;
  let cleaned = lowered;
  for (const suffix of SUFFIXES) {
    if (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length);
  }
  return cleaned.trim();
}

/** iOS convention (SmartScanReviewView.combinedPhone): "(555) 555-1234 x4421". */
export function combineBrokerPhone(phone: string | null, extension: string | null): string | null {
  const p = (phone ?? "").trim();
  const ext = (extension ?? "").trim().replace(/^x/i, "").trim();
  if (!p) return null;
  return ext ? `${p} x${ext}` : p;
}
