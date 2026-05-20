// =============================================================================
//  Loads constants — Carrier HQ
// -----------------------------------------------------------------------------
//  Non-server module. The server action file (actions.ts) and the client
//  NewLoadForm both import the same source of truth here so the dropdown
//  options and server validation can never drift.
// =============================================================================

export const LOAD_STATUSES = [
  "unassigned",
  "assigned",
  "in_transit",
  "delivered",
  "ready_for_settlement",
  "settled",
  "cancelled",
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

// Alias kept so NewLoadForm's existing import (and any future ones) reads
// naturally without referencing the more-generic LOAD_STATUSES name.
export const LOAD_STATUS_OPTIONS: ReadonlyArray<LoadStatus> = LOAD_STATUSES;
