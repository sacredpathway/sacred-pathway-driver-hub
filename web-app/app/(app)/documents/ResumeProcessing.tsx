// =============================================================================
//  Finishes uploads whose reading was interrupted (tab closed, network drop,
//  crash). Runs the same processDocumentAction as a fresh upload, one file at a
//  time; the server's claim makes a second runner a no-op ("busy").
// =============================================================================

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { processDocumentAction, runAutoPayrollAction } from "./actions";

export function ResumeProcessing({ ids, payrollIds = [] }: { ids: string[]; payrollIds?: string[] }) {
  const router = useRouter();
  const total = ids.length + payrollIds.length;
  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (ids.length + payrollIds.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const id of ids) {
        if (cancelled) return;
        try { await processDocumentAction(id); } catch { /* stays in review with Retry */ }
        if (!cancelled) setLeft((n) => n - 1);
      }
      for (const id of payrollIds) {
        if (cancelled) return;
        try { await runAutoPayrollAction(id); } catch { /* "Try again" stays available */ }
        if (!cancelled) setLeft((n) => n - 1);
      }
      if (!cancelled) router.refresh();
    })();
    return () => { cancelled = true; };
  }, [ids, payrollIds, router]);
  if (total === 0 || left === 0) return null;
  return (
    <p data-testid="resume-banner" className="rounded-md border border-white/10 bg-sp-cardLight px-3 py-2 text-xs text-sp-textSecondary">
      Finishing {left} upload{left === 1 ? "" : "s"} that didn&apos;t finish earlier…
    </p>
  );
}
