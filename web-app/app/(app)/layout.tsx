// Authenticated app shell. Every page in the (app) route group inherits
// this layout — nav at top, max-w container, signed-in guard handled by
// middleware so we can render with confidence here.

import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export const runtime = "edge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Pull the carrier's branded company name + logo for the Nav header. Both
  // are nullable — Nav falls back to "Driver Hub" + the gold "DH" tile when
  // either is missing. Phase W4.
  let companyName: string | null = null;
  let logoUrl: string | null = null;
  if (user) {
    const { data: profileRaw } = await supabase
      .from("profiles")
      .select("company_name, logo_storage_path")
      .eq("id", user.id)
      .maybeSingle();

    companyName = (profileRaw?.company_name as string | null) ?? null;
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
    <div className="flex min-h-dvh flex-col bg-sp-background text-sp-textPrimary">
      <Nav
        email={user?.email ?? null}
        companyName={companyName}
        logoUrl={logoUrl}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-white/5 px-4 py-3 text-center text-xs text-sp-textSecondary">
        {companyName ? `${companyName} · ` : ""}Driver Hub · Sacred Pathway · Cloud Sync dashboard
      </footer>
    </div>
  );
}
