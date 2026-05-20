// =============================================================================
//  /fleet — landing with Trucks + Trailers sections
// -----------------------------------------------------------------------------
//  Two read-only lists side by side with quick-add CTAs. Edit / delete /
//  link-to-loads land in later W3 steps.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import type { Truck, Trailer, FleetStatus } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: trucksRaw, error: truckErr }, { data: trailersRaw, error: trailerErr }] =
    await Promise.all([
      supabase
        .from("trucks")
        .select("*")
        .order("status", { ascending: true })
        .order("unit_number", { ascending: true }),
      supabase
        .from("trailers")
        .select("*")
        .order("status", { ascending: true })
        .order("unit_number", { ascending: true }),
    ]);

  const trucks: Truck[] = (trucksRaw ?? []) as Truck[];
  const trailers: Trailer[] = (trailersRaw ?? []) as Trailer[];

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fleet</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Power units and trailers tied to your authority. Status drives
            availability in load assignment (later in W3).
          </p>
        </div>
      </header>

      {sp.added === "truck" && <FlashOK message="Truck added." />}
      {sp.added === "trailer" && <FlashOK message="Trailer added." />}
      {(truckErr || trailerErr) && (
        <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
          {truckErr?.message ?? trailerErr?.message}
        </div>
      )}

      <FleetSection
        title="Trucks"
        addHref="/fleet/trucks/new"
        addLabel="+ Add truck"
        count={trucks.length}
      >
        {trucks.length === 0 ? (
          <EmptyState
            title="No trucks yet"
            body="Add your power units so loads can be assigned and IFTA / maintenance tracking can group by unit."
            cta={
              <Link
                href="/fleet/trucks/new"
                className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
              >
                Add your first truck
              </Link>
            }
          />
        ) : (
          <TruckTable trucks={trucks} />
        )}
      </FleetSection>

      <FleetSection
        title="Trailers"
        addHref="/fleet/trailers/new"
        addLabel="+ Add trailer"
        count={trailers.length}
      >
        {trailers.length === 0 ? (
          <EmptyState
            title="No trailers yet"
            body="Track dry vans, reefers, flatbeds, and other equipment. Trailer type is optional but unlocks group-by-equipment reports later."
            cta={
              <Link
                href="/fleet/trailers/new"
                className="inline-block rounded-md bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black hover:bg-sp-goldLight"
              >
                Add your first trailer
              </Link>
            }
          />
        ) : (
          <TrailerTable trailers={trailers} />
        )}
      </FleetSection>
    </section>
  );
}

// =============================================================================
//  Section wrapper
// =============================================================================

function FleetSection({
  title,
  addHref,
  addLabel,
  count,
  children,
}: {
  title: string;
  addHref: string;
  addLabel: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-sp-textPrimary">{title}</h2>
          <span className="text-xs text-sp-textSecondary">
            {count} {count === 1 ? title.toLowerCase().slice(0, -1) : title.toLowerCase()}
          </span>
        </div>
        <Link
          href={addHref}
          className="rounded-md bg-sp-gold px-3 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          {addLabel}
        </Link>
      </header>
      {children}
    </section>
  );
}

// =============================================================================
//  Tables
// =============================================================================

function TruckTable({ trucks }: { trucks: Truck[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-3">Unit #</th>
            <th className="px-3 py-3">Year / Make / Model</th>
            <th className="hidden px-3 py-3 md:table-cell">VIN</th>
            <th className="hidden px-3 py-3 md:table-cell">Plate</th>
            <th className="px-3 py-3">Status</th>
            <th className="hidden px-3 py-3 md:table-cell">Added</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {trucks.map((t) => (
            <tr key={t.id} className="hover:bg-white/5">
              <td className="px-3 py-3 font-medium text-sp-textPrimary">{t.unit_number}</td>
              <td className="px-3 py-3 text-sp-textSecondary">{ymm(t)}</td>
              <td className="hidden px-3 py-3 font-mono text-[11px] text-sp-textSecondary md:table-cell">
                {t.vin ?? "—"}
              </td>
              <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                {t.plate_number ?? "—"} {t.state ? `· ${t.state}` : ""}
              </td>
              <td className="px-3 py-3">
                <StatusPill status={t.status} />
              </td>
              <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                {formatDate(t.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrailerTable({ trailers }: { trailers: Trailer[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
          <tr>
            <th className="px-3 py-3">Unit #</th>
            <th className="px-3 py-3">Type</th>
            <th className="hidden px-3 py-3 md:table-cell">Year / Make / Model</th>
            <th className="hidden px-3 py-3 md:table-cell">VIN</th>
            <th className="hidden px-3 py-3 md:table-cell">Plate</th>
            <th className="px-3 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-sp-card/30">
          {trailers.map((t) => (
            <tr key={t.id} className="hover:bg-white/5">
              <td className="px-3 py-3 font-medium text-sp-textPrimary">{t.unit_number}</td>
              <td className="px-3 py-3 text-sp-textSecondary">{trailerTypeLabel(t.trailer_type)}</td>
              <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">{ymm(t)}</td>
              <td className="hidden px-3 py-3 font-mono text-[11px] text-sp-textSecondary md:table-cell">
                {t.vin ?? "—"}
              </td>
              <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                {t.plate_number ?? "—"} {t.state ? `· ${t.state}` : ""}
              </td>
              <td className="px-3 py-3">
                <StatusPill status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: FleetStatus }) {
  const cls =
    status === "active" ? "bg-sp-success/15 text-sp-success"
    : status === "maintenance" ? "bg-sp-warning/15 text-sp-warning"
    : status === "sold" ? "bg-sp-danger/15 text-sp-danger"
    : "bg-white/5 text-sp-textSecondary"; // inactive
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function FlashOK({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
      {message}
    </div>
  );
}

function ymm(t: { year: number | null; make: string | null; model: string | null }): string {
  const parts = [t.year, t.make, t.model].filter(Boolean);
  return parts.length === 0 ? "—" : parts.join(" ");
}

function trailerTypeLabel(t: string | null): string {
  if (!t) return "—";
  return t.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
