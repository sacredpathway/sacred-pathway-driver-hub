// AppShell — authenticated layout frame: skip link, optional sponsorship
// banner, desktop sidebar, mobile header/drawer, desktop top bar, content.
import type { ReactNode } from "react";
import type { AppAccessLevel } from "@/lib/nav/config";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";
import TopBar from "./TopBar";

export default function AppShell({
  children,
  email,
  companyName,
  logoUrl,
  accessLevel,
  banner,
}: {
  children: ReactNode;
  email?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  accessLevel?: AppAccessLevel;
  banner?: ReactNode;
}) {
  const identity = { email, companyName, logoUrl, accessLevel };
  return (
    <div className="min-h-dvh bg-sp-background text-sp-textPrimary print:bg-white print:text-black">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-lg bg-sp-gold px-4 py-2 text-sm font-semibold text-sp-black focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      {banner}
      <div className="flex">
        <Sidebar {...identity} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNavigation {...identity} />
          <TopBar companyName={companyName} />
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:px-0 print:py-0"
          >
            {children}
          </main>
          <footer className="border-t border-white/[0.06] px-4 py-4 text-center text-xs text-sp-textSecondary sm:px-6 lg:px-8 print:hidden">
            {companyName ? `${companyName} · ` : ""}Driver Hub · Sacred Pathway · Cloud Sync dashboard
          </footer>
        </div>
      </div>
    </div>
  );
}
