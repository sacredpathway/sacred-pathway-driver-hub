// Company identity block. Behaviour carried over from the old Nav (Phase W4):
// uploaded logo → that image; otherwise the gold "DH" tile. Company name →
// that name; otherwise "Driver Hub". Product line stays "Sacred Pathway Driver Hub".
import { cx } from "@/components/ui/cx";

export default function BrandMark({
  companyName,
  logoUrl,
  compact = false,
}: {
  companyName?: string | null;
  logoUrl?: string | null;
  compact?: boolean;
}) {
  const displayName = companyName?.trim() ? companyName.trim() : "Driver Hub";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={companyName ? `${companyName} logo` : "Company logo"}
          className="h-9 w-9 shrink-0 rounded-lg bg-white/5 object-contain"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sp-gold text-xs font-bold text-sp-black"
        >
          DH
        </span>
      )}
      <span className={cx("min-w-0", compact && "sr-only")}>
        <span className="block truncate text-sm font-semibold tracking-tight text-sp-textPrimary">{displayName}</span>
        <span className="block truncate text-[11px] text-sp-textSecondary">Sacred Pathway Driver Hub</span>
      </span>
    </span>
  );
}
