// Account / sign-out block at the foot of the sidebar and the mobile drawer.
// Sign out is the existing POST /auth/signout route.
import { LogOut } from "lucide-react";
import { cx } from "@/components/ui/cx";

const ACCESS_LABEL: Record<string, string> = {
  carrier_admin: "Carrier admin",
  carrier_driver: "Driver",
  basic_driver: "Basic Driver",
  free: "Free",
};

export default function AccountPanel({
  email,
  accessLevel,
  collapsed = false,
}: {
  email?: string | null;
  accessLevel?: string;
  collapsed?: boolean;
}) {
  const initial = (email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={cx("flex items-center gap-2", collapsed ? "flex-col" : "")}>
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold text-sp-textPrimary"
      >
        {initial}
      </span>
      <div className={cx("min-w-0 flex-1", collapsed && "sr-only")}>
        <p className="truncate text-xs font-medium text-sp-textPrimary" title={email ?? undefined}>
          {email ?? "Signed in"}
        </p>
        {accessLevel && ACCESS_LABEL[accessLevel] && (
          <p className="truncate text-[11px] text-sp-textSecondary">{ACCESS_LABEL[accessLevel]}</p>
        )}
      </div>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sp-textSecondary transition-colors hover:bg-white/[0.06] hover:text-sp-textPrimary"
        >
          <LogOut aria-hidden className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </button>
      </form>
    </div>
  );
}
