// =============================================================================
//  /documents — Carrier HQ Phase W5
// -----------------------------------------------------------------------------
//  Added in W5:
//    • Browser upload card (multi-file, drag-drop)
//    • Search + filter (type, broker, load #, date range)
//    • Per-row Delete (server action)
//    • Joined broker name + load # via a single in-memory join from loads
//
//  Preserves the existing signed-URL Open links + read-only table layout.
//  iOS uploads continue to land here unchanged via the same `documents`
//  bucket; this UI is purely additive.
// =============================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import type { TruckDocument, Load } from "@/lib/supabase/types";
import UploadCard from "./UploadCard";
import DeleteDocButton from "./DeleteDocButton";
import { DOCUMENT_TYPES } from "./constants";
import { ReviewQueue, RecentlyFiled, type FiledItem, type Option, type ReviewItem } from "./ReviewQueue";
import { documentTypeLabel, storedValuesForType } from "@/lib/documents/taxonomy";
import { FIELDS_BY_TYPE } from "@/lib/documents/extraction";
import { effectiveExtraction } from "@/lib/documents/routing";
import type { RoutingRecord } from "@/lib/documents/types";

interface Filters {
  type?: string;
  broker?: string;
  loadNumber?: string;
  from?: string;
  to?: string;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    deleted?: string;
    type?: string;
    broker?: string;
    load_number?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters: Filters = {
    type:       sp.type        ?? undefined,
    broker:     sp.broker      ?? undefined,
    loadNumber: sp.load_number ?? undefined,
    from:       sp.from        ?? undefined,
    to:         sp.to          ?? undefined,
  };

  const supabase = await createClient();

  // -----------------------------------------------------------------------
  // Pull every doc + every load + every broker. For a single carrier the
  // dataset is small (typically <1k loads, <2k docs). In-memory joins keep
  // the SQL simple and let us filter across joined columns without an RPC.
  // If the dataset grows past ~10k rows we'll move to a SQL view.
  // -----------------------------------------------------------------------
  const [{ data: docsRaw, error: docErr }, { data: loadsRaw }, { data: driversRaw }] = await Promise.all([
    (async () => {
      let q = supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      // Include historical spellings (e.g. "lumper" for lumper_fee) — no rename.
      if (filters.type) q = q.in("document_type", storedValuesForType(filters.type));
      if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00.000Z`);
      if (filters.to)   q = q.lte("created_at", `${filters.to}T23:59:59.999Z`);
      return q;
    })(),
    supabase
      .from("loads")
      .select("id, load_number, broker_name, pickup_date"),
    supabase
      .from("drivers")
      .select("id, name, active")
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(500),
  ]);

  if (docErr) {
    return (
      <div className="rounded-lg border border-sp-danger/40 bg-sp-danger/10 p-4 text-sm text-sp-danger">
        {docErr.message}
      </div>
    );
  }

  const loads = (loadsRaw ?? []) as Array<
    Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">
  >;
  const loadById = new Map(loads.map((l) => [l.id, l]));

  // Unique broker names from loads — for the filter dropdown.
  const brokerSet = new Set<string>();
  for (const l of loads) {
    if (l.broker_name?.trim()) brokerSet.add(l.broker_name.trim());
  }
  const brokers = [...brokerSet].sort((a, b) => a.localeCompare(b));

  // Apply post-join filters (broker name + load #) in-memory.
  const docsAll = (docsRaw ?? []) as TruckDocument[];
  let documents = docsAll;
  if (filters.broker) {
    documents = documents.filter((d) => {
      const l = d.load_id ? loadById.get(d.load_id) : undefined;
      return (l?.broker_name ?? "").trim() === filters.broker;
    });
  }
  if (filters.loadNumber) {
    const needle = filters.loadNumber.toLowerCase();
    documents = documents.filter((d) => {
      const l = d.load_id ? loadById.get(d.load_id) : undefined;
      return (l?.load_number ?? "").toLowerCase().includes(needle);
    });
  }

  // Sign URLs only for the visible rows (cheaper than signing the whole set).
  const links = await Promise.all(
    documents.map(async (d) => {
      const { data: signed } = await supabase
        .storage
        .from("documents")
        .createSignedUrl(d.storage_path, 60 * 30);
      return { id: d.id, url: signed?.signedUrl ?? null };
    })
  );
  const linkMap = new Map(links.map((l) => [l.id, l.url]));

  // ---------------------------------------------------------------------
  // Review queue + recently filed (computed from the same rows).
  // Only website uploads (source = 'web') are offered "Extract now"; the
  // older iPhone rows still pending since April are NOT touched here (they
  // need the separate dry-run backfill).
  // ---------------------------------------------------------------------
  const loadLabel = (l: Pick<Load, "id" | "load_number" | "broker_name" | "pickup_date">) =>
    [l.load_number ? `#${l.load_number}` : l.id.slice(0, 8), l.broker_name, l.pickup_date].filter(Boolean).join(" · ");
  const loadOptions: Option[] = loads.map((l) => ({ id: l.id, label: loadLabel(l) }));
  const driverOptions: Option[] = ((driversRaw ?? []) as Array<{ id: string; name: string; active: boolean | null }>)
    .map((d) => ({ id: d.id, label: d.active === false ? `${d.name} (inactive)` : d.name }));

  const reviewDocs = docsAll.filter(
    (d) => d.review_status === "needs_review" || (d.source === "web" && d.review_status == null),
  );
  const reviewUrls = new Map(
    await Promise.all(
      reviewDocs.map(async (d) => {
        if (linkMap.has(d.id)) return [d.id, linkMap.get(d.id) ?? null] as const;
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 60 * 30);
        return [d.id, signed?.signedUrl ?? null] as const;
      }),
    ),
  );
  const reviewItems: ReviewItem[] = reviewDocs.map((d) => {
    const routing = (d.routing ?? null) as RoutingRecord | null;
    const ai = effectiveExtraction(d.extracted_data, null).extraction;
    const type = routing?.type ?? ai.document_type;
    const linked = d.load_id ? loadById.get(d.load_id) : undefined;
    return {
      id: d.id,
      url: reviewUrls.get(d.id) ?? null,
      createdAt: d.created_at,
      status: d.status ?? "pending",
      errorMessage: d.error_message ?? null,
      duplicateOf: d.duplicate_of ?? null,
      type,
      typeLabel: documentTypeLabel(type),
      routing,
      aiFields: ai.fields,
      corrections: routing?.corrections ?? {},
      editableFields: [...FIELDS_BY_TYPE[type]],
      linkedLoadLabel: linked ? loadLabel(linked) : null,
    };
  });

  const filedItems: FiledItem[] = docsAll
    .filter((d) => d.review_status === "auto_routed" || d.review_status === "approved")
    .map((d) => {
      const routing = d.routing as RoutingRecord | null;
      const actions = (routing?.applied ?? [])
        .map((action, index) => ({ action, index }))
        .filter((x) => !x.action.undone_at)
        .map(({ action, index }) => ({
          index,
          action,
          label:
            action.kind === "attach_load"
              ? `attached to load ${String(action.after.load_number ?? "")}`
              : action.kind === "create_expense"
              ? `expense $${Number(action.after.amount ?? 0).toFixed(2)} ${String(action.after.vendor_name ?? "")}`
              : action.kind === "attach_driver_document"
              ? `filed to driver ${String(action.after.title ?? "")}`
              : `load ${String(action.after.load_number ?? "")} created`,
        }));
      return { id: d.id, typeLabel: documentTypeLabel(routing?.type ?? d.document_type), routedAt: d.reviewed_at ?? d.updated_at ?? null, actions };
    })
    .filter((i) => i.actions.length > 0)
    .sort((a, b) => String(b.actions[0]?.action.applied_at).localeCompare(String(a.actions[0]?.action.applied_at)))
    .slice(0, 10);

  const anyFilter =
    !!(filters.type || filters.broker || filters.loadNumber || filters.from || filters.to);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">
            Rate confirmations, BOLs, PODs, lumper slips, receipts. Open links
            are signed and expire 30 minutes after page load.
          </p>
        </div>
        <span className="text-xs text-sp-textSecondary">
          {documents.length} of {docsAll.length} {docsAll.length === 1 ? "file" : "files"}
        </span>
      </header>

      {sp.deleted && (
        <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          Document deleted.
        </div>
      )}

      {/* Upload card — #upload is the target of the dashboard / top-bar "Upload" action */}
      <div id="upload" className="scroll-mt-20">
        <UploadCard loads={loads} />
      </div>

      <ReviewQueue items={reviewItems} loads={loadOptions} drivers={driverOptions} />
      <RecentlyFiled items={filedItems} />

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        brokers={brokers}
        active={anyFilter}
      />

      {/* Table or empty state */}
      {docsAll.length === 0 ? (
        <EmptyState
          title="No documents yet"
          body="Upload rate cons, BOLs, PODs, or receipts above. Or upload from the iPhone Document Vault — both land in the same place."
        />
      ) : documents.length === 0 ? (
        <EmptyState
          title="No documents match those filters"
          body="Try clearing one of the filters above."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
              <tr>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Broker</th>
                <th className="px-3 py-3">Load #</th>
                <th className="hidden px-3 py-3 md:table-cell">Status</th>
                <th className="hidden px-3 py-3 md:table-cell">Created</th>
                <th className="px-3 py-3 text-right">Open</th>
                <th className="px-3 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-sp-card/30">
              {documents.map((d) => {
                const url = linkMap.get(d.id);
                const linkedLoad = d.load_id ? loadById.get(d.load_id) : undefined;
                return (
                  <tr key={d.id} className="hover:bg-white/5">
                    <td className="px-3 py-3 font-medium text-sp-textPrimary">
                      {documentTypeLabel(d.document_type)}
                    </td>
                    <td className="px-3 py-3 text-sp-textSecondary">
                      {linkedLoad?.broker_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sp-textSecondary">
                      {linkedLoad?.load_number ? (
                        <Link
                          href={`/loads/${linkedLoad.id}`}
                          className="hover:text-sp-gold"
                        >
                          #{linkedLoad.load_number}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                      {d.status ?? "—"}
                    </td>
                    <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">
                      {formatDate(d.created_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md bg-sp-gold/15 px-3 py-1 text-xs font-semibold text-sp-gold hover:bg-sp-gold/25"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-xs text-sp-textSecondary">unavailable</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DeleteDocButton documentId={d.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// =============================================================================
//  Filter bar
// -----------------------------------------------------------------------------
//  Submits via GET so the URL is shareable and the page is fully cacheable.
//  Hidden empty inputs are stripped from the URL by the browser automatically.
// =============================================================================

function FilterBar({
  filters,
  brokers,
  active,
}: {
  filters: Filters;
  brokers: ReadonlyArray<string>;
  active: boolean;
}) {
  return (
    <form
      method="get"
      action="/documents"
      className="space-y-3 rounded-xl border border-white/5 bg-sp-card p-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sp-textPrimary">Filter</h2>
        {active && (
          <Link
            href="/documents"
            className="text-xs text-sp-gold hover:underline"
          >
            Clear all
          </Link>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Type
          </span>
          <select
            name="type"
            defaultValue={filters.type ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {documentTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Broker
          </span>
          <select
            name="broker"
            defaultValue={filters.broker ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          >
            <option value="">All brokers</option>
            {brokers.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            Load #
          </span>
          <input
            type="text"
            name="load_number"
            defaultValue={filters.loadNumber ?? ""}
            placeholder="e.g. 12345"
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            From
          </span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sp-textSecondary">
            To
          </span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            className="w-full rounded-lg bg-sp-cardLight px-3 py-2 text-sm text-sp-textPrimary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-sp-gold px-4 py-1.5 text-xs font-semibold text-sp-black hover:bg-sp-goldLight"
        >
          Apply filters
        </button>
      </div>
    </form>
  );
}
