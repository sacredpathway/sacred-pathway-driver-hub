// =============================================================================
//  PrintAutoTrigger — Carrier HQ Phase W6
// -----------------------------------------------------------------------------
//  Tiny client component that fires window.print() once the print view loads.
//  Wrapped in a setTimeout so any web fonts/CSS finish laying out first;
//  isolated as its own component so the parent print shell can stay a server
//  component.
// =============================================================================

"use client";

import { useEffect } from "react";

export default function PrintAutoTrigger() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        // Safari throws inside some iframe sandboxes — non-fatal; the
        // carrier can still hit Cmd/Ctrl+P themselves.
      }
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return null;
}
