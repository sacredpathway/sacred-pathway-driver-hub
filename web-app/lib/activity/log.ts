// =============================================================================
//  Activity logging — Carrier HQ Phase W9
// -----------------------------------------------------------------------------
//  Single helper every write action calls after a successful mutation. The
//  insert is wrapped in try/catch and ALWAYS returns void — by design the
//  underlying action never fails because we couldn't write to activity_log.
//
//  The DB is permissive on entity_type / action strings; this file is the
//  enum + label authority so the dashboard feed gets consistent vocabulary.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivityEntityType =
  | "load"
  | "driver"
  | "expense"
  | "document"
  | "paystub"
  | "settlement"
  | "profile";

export type ActivityAction =
  // generic CRUD
  | "created"
  | "updated"
  | "deleted"
  // paystub status transitions
  | "issued"
  | "paid"
  | "voided"
  | "draft_added_line"
  // entity-specific
  | "uploaded"
  | "converted"
  | "assigned"
  | "deactivated"
  | "reactivated"
  | "branding_updated"
  | "logo_uploaded"
  | "logo_removed";

export interface LogActivityInput {
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  /**
   * Tiny JSON-serializable bag. Keep this short — it lands in JSONB and is
   * inlined in the dashboard feed via JSON.stringify if no `label` is set.
   * Recommended keys:
   *   label  — human-readable one-liner ("Load #45122 created for TQL")
   *   amount — number, displays as currency in the feed
   *   driver — driver name snapshot
   *   from   — previous status
   *   to     — new status
   */
  metadata?: Record<string, unknown>;
}

export interface ActivityRow {
  id: string;
  profile_id: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

/**
 * Fire-and-forget activity insert. Caller passes its already-authenticated
 * Supabase client + user id; we do NOT re-auth here so the cost is one
 * extra Postgres write per action.
 */
export async function logActivity(
  supabase: SupabaseClient,
  profileId: string,
  input: LogActivityInput
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      profile_id:    profileId,
      actor_user_id: profileId,         // single-user today; matches RLS scope
      entity_type:   input.entityType,
      entity_id:     input.entityId,
      action:        input.action,
      metadata:      input.metadata ?? null,
    });
  } catch {
    // Intentionally swallowed - logging must never break the user's write.
    // If insert fails (RLS denied, schema drift, network blip) we surface
    // nothing; the underlying action already succeeded.
  }
}

// -----------------------------------------------------------------------------
// Feed rendering helpers (server- or client-side, no React deps)
// -----------------------------------------------------------------------------

/** Best-effort one-line description of an activity for the feed list. */
export function activityLabel(row: ActivityRow): string {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  if (typeof m.label === "string" && m.label.trim()) return m.label.trim();

  const entity = humanEntity(row.entity_type);
  const verb = humanVerb(row.action);
  return `${entity} ${verb}`;
}

function humanEntity(entityType: string): string {
  switch (entityType) {
    case "load":       return "Load";
    case "driver":     return "Driver";
    case "expense":    return "Expense";
    case "document":   return "Document";
    case "paystub":    return "Paystub";
    case "settlement": return "Settlement";
    case "profile":    return "Settings";
    default:           return entityType;
  }
}

function humanVerb(action: string): string {
  switch (action) {
    case "created":            return "created";
    case "updated":            return "updated";
    case "deleted":            return "deleted";
    case "issued":             return "issued";
    case "paid":               return "marked paid";
    case "voided":             return "voided";
    case "draft_added_line":   return "line added to draft";
    case "uploaded":           return "uploaded";
    case "converted":          return "converted to paystub";
    case "assigned":           return "assignment updated";
    case "deactivated":        return "deactivated";
    case "reactivated":        return "reactivated";
    case "branding_updated":   return "branding updated";
    case "logo_uploaded":      return "logo uploaded";
    case "logo_removed":       return "logo removed";
    default:                   return action;
  }
}

/**
 * Build the in-app URL for an activity row. Returns null when the entity is
 * gone (deleted) or has no useful detail page.
 */
export function activityHref(row: ActivityRow): string | null {
  if (!row.entity_id) return null;
  if (row.action === "deleted") return null;
  switch (row.entity_type) {
    case "load":       return `/loads/${row.entity_id}`;
    case "driver":     return `/drivers/${row.entity_id}`;
    case "expense":    return `/expenses/${row.entity_id}`;
    case "document":   return "/documents";
    case "paystub":    return `/payroll/${row.entity_id}`;
    case "settlement": return `/settlements/${row.entity_id}`;
    case "profile":    return "/settings";
    default:           return null;
  }
}
