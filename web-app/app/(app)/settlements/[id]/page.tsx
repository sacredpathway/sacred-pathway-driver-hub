// =============================================================================
//  /settlements/[id] — settlement workspace
// -----------------------------------------------------------------------------
//  The `id` may be:
//    • a settlements.id on the live settlement model  → full editor (locked
//      read-only when approved / paid / voided until reopened)
//    • an old pre-engine iOS settlement row (no engine version, no lines)
//      → read-only legacy summary (editing it would recompute from nothing)
//    • a paystubs.id → read-only legacy paystub summary (web paystubs are
//      retired; history only)
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Paystub, Driver } from "@/lib/supabase/types";
import { eligibleLoads, resolveToday, type LoadRow } from "@/lib/settlements/workflow";
import { effectivePayRule } from "@/lib/settlements/model";
import {
  ledgerFacts, listCustomCategories, loadBundle, recentOtherDescriptions, recurringRulesFor,
} from "@/lib/settlements/server";
import SettlementEditor, { type AuditRow } from "./SettlementEditor";

const LOAD_COLUMNS =
  "id, driver_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, " +
  "destination, total_miles, empty_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue, status";

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 1. Legacy web paystub (read-only)
  const { data: paystubRaw } = await supabase.from("paystubs").select("*").eq("id", id).maybeSingle();
  if (paystubRaw) {
    const p = paystubRaw as Paystub;
    const driver = await fetchDriver(supabase, p.driver_id);
    return <PaystubView paystub={p} driverName={driver?.name ?? "Unknown driver"} />;
  }

  // 2. Settlement
  const loaded = await loadBundle(supabase, id);
  if (!loaded) notFound();
  const { bundle } = loaded;
  const driver = await fetchDriver(supabase, bundle.header.driverId);

  const isPreEngineLegacy = !bundle.header.engineVersion && bundle.loadLines.length === 0
    && bundle.additions.length === 0 && bundle.deductions.length === 0;
  if (isPreEngineLegacy) {
    return <LegacyView raw={loaded.raw} driverName={driver?.name ?? null} />;
  }

  // Show the rule the engine actually uses. For legacy rows with no stored
  // rule this is the iPhone's Decimal(Double) fallback (exact digits).
  if (!bundle.header.payRule || bundle.header.payRule.components.length === 0) {
    const eff = effectivePayRule(bundle.header);
    if (eff.components.length > 0) bundle.header.payRule = eff;
  }
  const canEdit = !!user && bundle.header.profileId === user.id;
  const [customs, suggestions, rules, facts, auditRes] = await Promise.all([
    listCustomCategories(supabase),
    recentOtherDescriptions(supabase),
    recurringRulesFor(supabase, bundle.header.driverId),
    ledgerFacts(supabase, id),
    supabase.from("settlement_audit_events").select("id, action, summary, actor_name, timestamp")
      .eq("settlement_id", id).order("timestamp", { ascending: false }).limit(200),
  ]);

  let eligible: LoadRow[] = [];
  if (canEdit && bundle.header.driverId && bundle.header.periodStart && bundle.header.periodEnd) {
    const { data: lRaw } = await supabase.from("loads").select(LOAD_COLUMNS).eq("driver_id", bundle.header.driverId);
    const today = resolveToday(null, new Date());
    eligible = eligibleLoads((lRaw ?? []) as unknown as LoadRow[], bundle.header.driverId, bundle.header.periodStart, bundle.header.periodEnd, facts.alreadyPaid, today)
      .filter((e) => !e.alreadyPaidOn)
      .map((e) => e.load);
  }

  return (
    <SettlementEditor
      // Keyed by settlement, not version: autosave must not remount the
      // editor (and wipe what the user is typing) every time it saves.
      key={bundle.header.id}
      initial={bundle}
      updatedAt={bundle.header.updatedAt}
      driverName={driver?.name ?? "Unassigned"}
      canEdit={canEdit}
      customs={{ available: customs.available, categories: customs.categories, suggestions }}
      eligible={eligible}
      rules={rules}
      otherNumbers={facts.otherNumbers}
      alreadyPaid={[...facts.alreadyPaid.entries()]}
      auditTrail={((auditRes.data ?? []) as AuditRow[])}
    />
  );
}

async function fetchDriver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string | null,
): Promise<Pick<Driver, "id" | "name"> | null> {
  if (!driverId) return null;
  const { data } = await supabase.from("drivers").select("id, name").eq("id", driverId).maybeSingle();
  return (data ?? null) as Pick<Driver, "id" | "name"> | null;
}

// -----------------------------------------------------------------------------
//  Legacy views (read-only)
// -----------------------------------------------------------------------------

function PaystubView({ paystub: p, driverName }: { paystub: Paystub; driverName: string }) {
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Paystub for {driverName}</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">Legacy web paystub · read-only history · status {p.status}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/payroll" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">← Payroll history</Link>
          <Link href={`/payroll/${p.id}`} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">View paystub</Link>
        </div>
      </header>
      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <Row label="Driver">{driverName}</Row>
          <Row label="Worker type">{p.worker_type}</Row>
          <Row label="Pay period">{formatDate(p.pay_period_start)} → {formatDate(p.pay_period_end)}</Row>
          <Row label="Check date">{formatDate(p.check_date)}</Row>
          <Row label="Gross earnings">{formatCurrency(p.gross_earnings)}</Row>
          <Row label="Net pay" emphasis>{formatCurrency(p.net_pay)}</Row>
        </dl>
      </div>
    </section>
  );
}

function LegacyView({ raw, driverName }: { raw: Record<string, unknown>; driverName: string | null }) {
  const n = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : raw[k] === null || raw[k] === undefined ? null : Number(raw[k]));
  const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Legacy settlement</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">Older iPhone settlement (before itemized settlements) · read-only history</p>
        </div>
        <Link href="/payroll" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">← Payroll history</Link>
      </header>
      <div className="rounded-xl border border-white/5 bg-sp-card p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <Row label="Driver">{driverName ?? "Unassigned"}</Row>
          <Row label="Settlement period">{formatDate(s("settlement_period_start"))} → {formatDate(s("settlement_period_end"))}</Row>
          <Row label="Status">{s("status") ?? "—"}</Row>
          <Row label="Created">{formatDate(s("created_at"))}</Row>
          <Row label="Revenue">{formatCurrency(n("total_revenue"))}</Row>
          <Row label="Net pay" emphasis>{formatCurrency(n("net_pay"))}</Row>
        </dl>
      </div>
      <p className="text-xs text-sp-textSecondary">This record has no itemized lines, so it can’t be re-calculated. To pay the same week again, create a new settlement.</p>
    </section>
  );
}

function Row({ label, children, emphasis = false }: { label: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">{label}</dt>
      <dd className={"mt-0.5 text-sm " + (emphasis ? "font-semibold text-sp-gold" : "text-sp-textPrimary")}>{children}</dd>
    </div>
  );
}
