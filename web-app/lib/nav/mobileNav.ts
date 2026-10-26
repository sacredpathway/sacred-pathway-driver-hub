// =============================================================================
//  Mobile navigation drawer state — pure reducer
// -----------------------------------------------------------------------------
//  Kept framework-free so the open/close rules are unit-tested:
//    • the menu button toggles
//    • Escape, the backdrop, the close button and any route change close it
//    • a route change while already closed is a no-op (no re-render churn)
// =============================================================================

export interface MobileNavState {
  open: boolean;
  /** Path the drawer was last rendered for; a different path closes it. */
  pathname: string | null;
}

export type MobileNavEvent =
  | { type: "toggle" }
  | { type: "open" }
  | { type: "close" }
  | { type: "escape" }
  | { type: "route_change"; pathname: string | null };

export function initialMobileNavState(pathname: string | null): MobileNavState {
  return { open: false, pathname };
}

export function mobileNavReducer(state: MobileNavState, event: MobileNavEvent): MobileNavState {
  switch (event.type) {
    case "toggle":
      return { ...state, open: !state.open };
    case "open":
      return state.open ? state : { ...state, open: true };
    case "close":
    case "escape":
      return state.open ? { ...state, open: false } : state;
    case "route_change":
      if (event.pathname === state.pathname) return state;
      return { open: false, pathname: event.pathname };
  }
}
