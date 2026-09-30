// Skeleton placeholders for loading.tsx route states. Purely presentational:
// they never show numbers, so nothing can be mistaken for real data.
import { cx } from "./cx";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-white/[0.06]", className)} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-sp-card/80 p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}
