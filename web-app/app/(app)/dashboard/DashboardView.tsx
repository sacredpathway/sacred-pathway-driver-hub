// =============================================================================
//  DashboardView — presentation only (Phase A)
// -----------------------------------------------------------------------------
//  Receives already-computed values from page.tsx. No data access, no
//  calculations beyond formatting, no sample/fallback numbers.
// =============================================================================

import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, CircleDollarSign, FilePlus2, Gauge, Receipt, Route, Truck,
  Upload, UserPlus, Users, Wallet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import MetricCard from "@/components/ui/MetricCard";
import SectionCard from "@/components/ui/SectionCard";
import DataTable, { type DataColumn } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/StatusBadge";
import AttentionCard from "@/components/ui/AttentionCard";
import EmptyState from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { RANGE_PRESETS, type ResolvedRange } from "@/lib/reports/range";
import { activityHref, activityLabel, type ActivityRow } from "@/lib/activity/log";
import type { DashboardKpis } from "@/lib/dashboard/kpis";
import { ATTENTION_RULES, type AttentionSummary } from "@/lib/dashboard/attention";
import type { OperationsRow } from "@/lib/dashboard/operations";
import {
  settlementStatusLabel,
  settlementStatusTone,
  type RecentSettlementView,
} from "@/lib/dashboard/settlements";
import PeriodToggles from "./PeriodToggles";

const ATTENTION_VISIBLE = 6;

export interface DashboardViewProps {
  range: ResolvedRange;
  isCarrierAdmin: boolean;
  driverNeedsLink: boolean;
  loadsError: boolean;
  kpis: DashboardKpis;
  activeDrivers: { active: number; total: number } | null;
  attention: AttentionSummary;
  operations: { rows: OperationsRow[]; total: number };
  showDriverColumn: boolean;
  settlements: { rows: RecentSettlementView[]; error: boolean } | null;
  activity: ActivityRow[] | null;
}

export default function DashboardView(p: DashboardViewProps) {
  return (
    <div className="space-y-6 lg:space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Dashboard"
        subtitle={<>Showing <span className="text-sp-textPrimary">{p.range.preset === "all_time" ? "All time" : p.range.label}</span></>}
        actions={<PeriodToggles selected={p.range.preset} />}
      />

      <CustomRange range={p.range} />

      {p.driverNeedsLink && (
        <div role="status" className="rounded-2xl border border-sp-warning/30 bg-sp-warning/5 p-4 text-sm text-sp-textPrimary">
          <strong className="text-sp-warning">Almost there.</strong> Your carrier hasn&apos;t linked your account to a
          driver record yet, so your dashboard shows no totals. Ask your carrier admin to open
          <code className="mx-1 rounded bg-sp-cardLight px-1.5 py-0.5">/team</code>
          and assign your driver row — your loads and expenses will appear here the moment they do.
        </div>
      )}

      {p.loadsError && (
        <div role="alert" className="rounded-2xl border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-red-200">
          Loads couldn&apos;t be loaded right now, so load figures below may read zero. Refresh to try again.
        </div>
      )}

      <KpiRow {...p} />

      <div className="grid gap-6 xl:grid-cols-3">
        <AttentionSection attention={p.attention} className="xl:col-span-2" />
        <QuickActions isCarrierAdmin={p.isCarrierAdmin} />
      </div>

      <OperationsSection operations={p.operations} showDriverColumn={p.showDriverColumn} />

      {p.settlements && <SettlementsSection {...p.settlements} />}

      {p.activity && <ActivitySection rows={p.activity} />}
    </div>
  );
}

// ----------------------------------------------------------------------------
//  KPIs
// ----------------------------------------------------------------------------

function KpiRow({ kpis, range, activeDrivers }: DashboardViewProps) {
  const periodShort = range.preset === "all_time" ? "All time" : range.label.replace(/\s*\(.*\)$/, "");
  return (
    <section aria-label="Key figures">
      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${activeDrivers ? "2xl:grid-cols-6" : "2xl:grid-cols-5"}`}>
        <MetricCard
          label="Loads"
          value={formatNumber(kpis.loadCount)}
          hint={periodShort}
          icon={<Truck className="h-4 w-4" />}
        />
        <MetricCard
          label="Gross revenue"
          value={kpis.grossRevenue.format()}
          tone="gold"
          hint={
            <>
              {periodShort}
              {kpis.cancelledCount > 0 && (
                <span className="block text-orange-300">
                  Includes {kpis.cancelledRevenue.format()} on {kpis.cancelledCount} cancelled
                </span>
              )}
            </>
          }
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <MetricCard
          label="Miles"
          value={formatNumber(kpis.totalMiles)}
          hint={`${formatNumber(kpis.loadsWithMiles)} of ${formatNumber(kpis.loadCount)} loads have miles`}
          icon={<Route className="h-4 w-4" />}
        />
        <MetricCard
          label="Revenue / mile"
          value={kpis.revenuePerMile ? kpis.revenuePerMile.format() : "—"}
          hint={kpis.revenuePerMile ? "Loads with miles only" : "No miles recorded in period"}
          icon={<Gauge className="h-4 w-4" />}
        />
        <MetricCard
          label="Expenses"
          value={kpis.expenses.format()}
          hint={`${periodShort} · ${formatNumber(kpis.expenseCount)} logged`}
          icon={<Receipt className="h-4 w-4" />}
        />
        {activeDrivers && (
          <MetricCard
            label="Active drivers"
            value={formatNumber(activeDrivers.active)}
            hint={`of ${formatNumber(activeDrivers.total)} on roster`}
            icon={<Users className="h-4 w-4" />}
          />
        )}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
//  Attention Required
// ----------------------------------------------------------------------------

function AttentionSection({ attention, className }: { attention: AttentionSummary; className?: string }) {
  const shown = attention.items.slice(0, ATTENTION_VISIBLE);
  const summary = (Object.keys(attention.countsByRule) as Array<keyof typeof attention.countsByRule>)
    .filter((r) => attention.countsByRule[r] > 0);

  return (
    <SectionCard
      id="attention"
      title="Missing paperwork info"
      description={
        attention.total === 0
          ? `Loads from the last ${attention.windowDays} days`
          : `${attention.total} ${attention.total === 1 ? "item" : "items"} · loads from the last ${attention.windowDays} days`
      }
      className={className}
    >
      {attention.total === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-sp-success/20 bg-sp-success/[0.06] p-4 text-sm text-sp-textPrimary">
          <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0 text-emerald-300" />
          Every load from the last {attention.windowDays} days has its rate, miles, driver, delivery date and rate confirmation.
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="flex flex-wrap gap-2" aria-label="Missing paperwork summary">
            {summary.map((r) => (
              <li key={r}>
                <Badge tone="unknown">
                  {ATTENTION_RULES[r].title} · {attention.countsByRule[r]}
                </Badge>
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            {shown.map((i) => (
              <li key={`${i.rule}:${i.loadId}`}>
                <AttentionCard
                  title={ATTENTION_RULES[i.rule].title}
                  subject={i.loadLabel}
                  detail={i.detail}
                  href={i.href}
                  actionLabel={ATTENTION_RULES[i.rule].action}
                />
              </li>
            ))}
          </ul>
          {attention.total > shown.length && (
            <p className="text-xs text-sp-textSecondary">
              Showing {shown.length} of {attention.total}.{" "}
              <Link href="/loads" className="font-semibold text-sp-gold hover:text-sp-goldLight">
                Review all loads →
              </Link>
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
//  Quick actions — only workflows that exist today (no Create Settlement)
// ----------------------------------------------------------------------------

function QuickActions({ isCarrierAdmin }: { isCarrierAdmin: boolean }) {
  const actions = [
    ...(isCarrierAdmin
      ? [
          { href: "/loads/new", label: "New load", icon: FilePlus2, primary: true },
          { href: "/drivers/new", label: "Add driver", icon: UserPlus, primary: false },
        ]
      : []),
    { href: "/documents#upload", label: "Upload document", icon: Upload, primary: false },
    { href: "/expenses/new", label: "Record expense", icon: Wallet, primary: !isCarrierAdmin },
  ];
  return (
    <SectionCard title="Quick actions" description="Start a common task">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {actions.map((a) => (
          <li key={a.href}>
            <ButtonLink
              href={a.href}
              variant={a.primary ? "primary" : "secondary"}
              className="h-11 w-full justify-start"
            >
              <a.icon aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{a.label}</span>
            </ButtonLink>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
//  Recent loads (paperwork only — no status)
// ----------------------------------------------------------------------------

function OperationsSection({
  operations,
  showDriverColumn,
}: {
  operations: { rows: OperationsRow[]; total: number };
  showDriverColumn: boolean;
}) {
  const columns: DataColumn<OperationsRow>[] = [
    {
      key: "load",
      header: "Load",
      primary: true,
      cell: ({ load }) => (
        <span className="block min-w-0">
          <Link href={`/loads/${load.id}`} className="font-semibold text-sp-textPrimary hover:text-sp-gold">
            {load.load_number?.trim() || "No load #"}
          </Link>
          {load.broker_name && <span className="block truncate text-xs text-sp-textSecondary">{load.broker_name}</span>}
        </span>
      ),
    },
    ...(showDriverColumn
      ? [
          {
            key: "driver",
            header: "Driver",
            cell: ({ driverName }: OperationsRow) =>
              driverName ?? <span className="text-orange-300">Unassigned</span>,
          } satisfies DataColumn<OperationsRow>,
        ]
      : []),
    { key: "origin", header: "Origin", cell: ({ load }) => load.origin || "—" },
    { key: "destination", header: "Destination", cell: ({ load }) => load.destination || "—" },
    { key: "pickup", header: "Pickup", cell: ({ load }) => formatDate(load.pickup_date) },
    { key: "delivery", header: "Delivery", cell: ({ load }) => formatDate(load.delivery_date) },
    { key: "miles", header: "Miles", align: "right", cell: ({ load }) => formatNumber(load.total_miles) },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      cell: ({ load }) => <span className="font-semibold text-sp-gold">{formatCurrency(load.total_revenue)}</span>,
    },
  ];

  return (
    <SectionCard
      id="operations"
      title="Recent loads"
      description={`${formatNumber(operations.total)} ${operations.total === 1 ? "load" : "loads"} in period · newest first`}
      actions={
        <Link href="/loads" className="inline-flex min-h-[32px] items-center rounded-lg px-2 text-xs font-semibold text-sp-gold hover:bg-white/[0.05] hover:text-sp-goldLight">
          All loads →
        </Link>
      }
    >
      {operations.rows.length === 0 ? (
        <EmptyState
          compact
          icon={<Truck className="h-5 w-5" />}
          title="No loads in this period"
          body="Loads you enter show up here with their rate, miles and dates."
        />
      ) : (
        <>
          <DataTable
            caption="Recent loads"
            columns={columns}
            rows={operations.rows}
            rowKey={(r) => r.load.id}
            tableFrom="xl"
            renderCard={(r) => <OperationsCard row={r} showDriver={showDriverColumn} />}
          />
          {operations.total > operations.rows.length && (
            <p className="mt-3 text-xs text-sp-textSecondary">
              Showing {operations.rows.length} of {formatNumber(operations.total)} loads.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

function OperationsCard({ row: { load, driverName }, showDriver }: { row: OperationsRow; showDriver: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/loads/${load.id}`} className="text-sm font-semibold text-sp-textPrimary hover:text-sp-gold">
            {load.load_number?.trim() || "No load #"}
          </Link>
          {load.broker_name && <p className="truncate text-xs text-sp-textSecondary">{load.broker_name}</p>}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-sp-gold">{formatCurrency(load.total_revenue)}</span>
      </div>
      <p className="text-sm text-sp-textPrimary">
        {load.origin || "—"} <span aria-hidden className="text-sp-textSecondary">→</span>
        <span className="sr-only"> to </span> {load.destination || "—"}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-sp-textSecondary">
        <span>PU {formatDate(load.pickup_date)}</span>
        <span>DEL {formatDate(load.delivery_date)}</span>
        <span>{formatNumber(load.total_miles)} mi</span>
        {showDriver && (driverName ? <span className="text-sp-textPrimary">{driverName}</span> : <span className="text-orange-300">Unassigned</span>)}
      </div>
    </div>
  );
}

function SettlementCard({ s }: { s: RecentSettlementView }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sp-textPrimary">{s.driverName ?? "Driver not on roster"}</p>
          <p className="text-xs text-sp-textSecondary">
            {s.number ? `${s.number} · ` : ""}{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
          </p>
        </div>
        <Badge tone={settlementStatusTone(s.status)}>{settlementStatusLabel(s.status)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-sp-textSecondary">Driver gross</dt><dd className="text-right tabular-nums text-sp-textPrimary">{s.gross.format()}</dd>
        <dt className="text-sp-textSecondary">Additions</dt><dd className="text-right tabular-nums text-sp-textPrimary">{s.additions.format()}</dd>
        <dt className="text-sp-textSecondary">Deductions</dt><dd className="text-right tabular-nums text-sp-textPrimary">{s.deductions.format()}</dd>
        <dt className="font-semibold text-sp-textPrimary">Net pay</dt><dd className="text-right font-semibold tabular-nums text-sp-gold">{s.net.format()}</dd>
      </dl>
    </div>
  );
}

// ----------------------------------------------------------------------------
//  Recent settlements — authoritative model only
// ----------------------------------------------------------------------------

function SettlementsSection({ rows, error }: { rows: RecentSettlementView[]; error: boolean }) {
  const columns: DataColumn<RecentSettlementView>[] = [
    {
      key: "driver",
      header: "Driver",
      primary: true,
      cell: (s) => (
        <span className="block min-w-0">
          <span className="font-semibold text-sp-textPrimary">{s.driverName ?? "Driver not on roster"}</span>
          {s.number && <span className="block text-xs text-sp-textSecondary">{s.number}</span>}
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
      cell: (s) => `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`,
    },
    { key: "gross", header: "Driver gross", align: "right", cell: (s) => s.gross.format() },
    { key: "additions", header: "Additions", align: "right", cell: (s) => s.additions.format() },
    { key: "deductions", header: "Deductions", align: "right", cell: (s) => s.deductions.format() },
    {
      key: "net",
      header: "Net pay",
      align: "right",
      cell: (s) => <span className="font-semibold text-sp-gold">{s.net.format()}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => <Badge tone={settlementStatusTone(s.status)}>{settlementStatusLabel(s.status)}</Badge>,
    },
  ];

  return (
    <SectionCard
      id="settlements"
      title="Recent settlements"
      description="Driver settlements produced by the settlement engine"
      actions={
        <Link href="/settlements" className="inline-flex min-h-[32px] items-center rounded-lg px-2 text-xs font-semibold text-sp-gold hover:bg-white/[0.05] hover:text-sp-goldLight">
          Settlements →
        </Link>
      }
    >
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-200">
          <AlertTriangle aria-hidden className="h-4 w-4" /> Settlements couldn&apos;t be loaded right now.
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<Receipt className="h-5 w-5" />}
          title="No settlements yet"
          body="Finalized driver settlements will appear here with gross, additions, deductions and net pay. Earlier paystubs remain under Payroll."
        />
      ) : (
        <DataTable
          caption="Recent settlements"
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          tableFrom="xl"
          renderCard={(s) => <SettlementCard s={s} />}
        />
      )}
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
//  Recent activity (activity_log)
// ----------------------------------------------------------------------------

function ActivitySection({ rows }: { rows: ActivityRow[] }) {
  return (
    <SectionCard title="Recent activity" description="Changes made from the web app">
      {rows.length === 0 ? (
        <p className="text-sm text-sp-textSecondary">
          No activity logged yet. Loads, drivers, paystubs and documents you create on the web will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((r) => {
            const href = activityHref(r);
            const label = activityLabel(r);
            const meta = (r.metadata ?? {}) as Record<string, unknown>;
            const amount = typeof meta.amount === "number" ? meta.amount : null;
            return (
              <li key={r.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  {href ? (
                    <Link href={href} className="text-sp-textPrimary hover:text-sp-gold">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-sp-textPrimary">{label}</span>
                  )}
                  {amount !== null && <span className="ml-2 text-xs text-sp-gold">{formatCurrency(amount)}</span>}
                </div>
                <time dateTime={r.created_at ?? undefined} className="shrink-0 text-xs text-sp-textSecondary">
                  {formatDate(r.created_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ----------------------------------------------------------------------------
//  Custom date range (GET form — shareable URL, no client JS). Unchanged
//  behaviour from the previous dashboard; restyled.
// ----------------------------------------------------------------------------

function CustomRange({ range }: { range: ResolvedRange }) {
  const field =
    "h-10 rounded-lg border border-white/10 bg-sp-cardLight px-3 text-sm text-sp-textPrimary outline-none focus:border-sp-gold";
  return (
    <details className="group print:hidden" open={range.preset === "custom"}>
      <summary className="inline-flex min-h-[32px] cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 text-xs text-sp-textSecondary hover:bg-white/[0.05] hover:text-sp-textPrimary">
        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        More periods & custom dates
      </summary>
      <form method="get" action="/dashboard" className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-white/[0.06] bg-sp-card/80 p-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">Period</span>
          <select name="preset" defaultValue={range.preset} className={field}>
            {RANGE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">From</span>
          <input type="date" name="from" defaultValue={range.from} className={field} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">To</span>
          <input type="date" name="to" defaultValue={range.to} className={field} />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-sp-gold px-4 text-sm font-semibold text-sp-black hover:bg-sp-goldLight">
          Apply
        </button>
        <p className="basis-full text-[11px] text-sp-textSecondary">
          Applies to every figure and to Recent loads. Missing paperwork info always checks the last 30 days.
        </p>
      </form>
    </details>
  );
}
