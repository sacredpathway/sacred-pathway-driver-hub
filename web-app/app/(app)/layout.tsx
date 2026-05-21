// Authenticated app shell. Every page in the (app) route group inherits
// this layout — nav at top, max-w container, signed-in guard handled by
// middleware so we can render with confidence here.
//
// Phase: Carrier-Sponsored Driver Access
//   • Uses the centralized resolveAccess() to know if the user is a
//     carrier admin, a carrier-sponsored driver, or a free/outside driver.
//   • carrier_driver users see a "Provided by <Carrier>" banner above
//     the nav.
//   • Nav links are filtered by accessLevel so drivers don't see Carrier
//     admin pages like /team or /drivers (the roster CRUD).

import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import { resolveAccess } from "@/lib/entitlement/resolver";

export const runtime = "edge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const entitlement = await resolveAccess(supabase);

  // Pull the carrier's branded company name + logo for the Nav header. Both
  // are nullable — Nav falls back to "Driver Hub" + the gold "DH" tile when
  // either is missing. Phase W4.
  let companyName: string | null = entitlement.carrierCompanyName ?? null;
  let logoUrl: string | null = null;
  if (user) {
    // The branding shown in the Nav is the CARRIER's, even for sponsored
    // drivers — they're using the carrier's app surface.
    const targetProfileId = entitlement.carrierProfileId ?? user.id;
    const { data: profileRaw } = await supabase
      .from("profiles")
      .select("company_name, logo_storage_path")
      .eq("id", targetProfileId)
      .maybeSingle();

    if (!companyName) {
      companyName = (profileRaw?.company_name as string | null) ?? null;
    }
    const logoPath = (profileRaw?.logo_storage_path as string | null) ?? null;

    if (logoPath) {
      const { data: signed } = await supabase
        .storage
        .from("branding")
        .createSignedUrl(logoPath, 60 * 60);
      logoUrl = signed?.signedUrl ?? null;
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-sp-background text-sp-textPrimary print:bg-white print:text-black">
      {entitlement.isSponsored && (
        <div className="border-b border-sp-success/30 bg-sp-success/10 px-4 py-1.5 text-center text-[11px] text-sp-success print:hidden">
          Driver Hub Basic Driver access is provided by{" "}
          <span className="font-semibold">
            {entitlement.carrierCompanyName ?? "your carrier"}
          </span>
          .
        </div>
      )}
      <div className="print:hidden">
        <Nav
          email={user?.email ?? null}
          companyName={companyName}
          logoUrl={logoUrl}
          accessLevel={entitlement.accessLevel}
        />
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 print:max-w-none print:px-0 print:py-0">
        {children}
      </main>
      <footer className="border-t border-white/5 px-4 py-3 text-center text-xs text-sp-textSecondary print:hidden">
        {companyName ? `${companyName} · ` : ""}Driver Hub · Sacred Pathway · Cloud Sync dashboard
      </footer>
    </div>
  );
}
