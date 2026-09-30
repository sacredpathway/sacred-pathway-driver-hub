// =============================================================================
//  Loads constants — Carrier HQ
// -----------------------------------------------------------------------------
//  Non-server module. The server action file (actions.ts) and the client
//  forms both import the same source of truth so the dropdown options and
//  server validation can never drift. The vocabulary itself lives in
//  lib/loads/status.ts (shared with display code).
// =============================================================================

import { WRITABLE_LOAD_STATUSES, type WritableLoadStatus } from "@/lib/loads/status";

/**
 * Statuses the web may newly write. `cancelled` is intentionally excluded —
 * see the COMPATIBILITY GATE note on WRITABLE_LOAD_STATUSES.
 */
export const LOAD_STATUSES = WRITABLE_LOAD_STATUSES;

export type LoadStatus = WritableLoadStatus;

// Alias kept so NewLoadForm's existing import (and any future ones) reads
// naturally without referencing the more-generic LOAD_STATUSES name.
export const LOAD_STATUS_OPTIONS: ReadonlyArray<LoadStatus> = LOAD_STATUSES;
