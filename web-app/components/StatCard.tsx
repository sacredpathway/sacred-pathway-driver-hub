// Single metric tile for the dashboard. Server-rendered, no JS shipped.

export default function StatCard({
  label,
  value,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "gold" | "good" | "bad";
}) {
  const toneClass =
    tone === "gold" ? "text-sp-gold"
    : tone === "good" ? "text-sp-success"
    : tone === "bad" ? "text-sp-danger"
    : "text-sp-textPrimary";

  return (
    <div className="rounded-xl border border-white/5 bg-sp-card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tracking-tight ${toneClass}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-1 text-xs text-sp-textSecondary">{sublabel}</div>
      )}
    </div>
  );
}
