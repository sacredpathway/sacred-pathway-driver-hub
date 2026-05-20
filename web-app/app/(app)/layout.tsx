// Authenticated app shell. Every page in the (app) route group inherits
// this layout — nav at top, max-w container, signed-in guard handled by
// middleware so we can render with confidence here.

import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/Nav";

export const runtime = "edge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-dvh flex-col bg-sp-background text-sp-textPrimary">
      <Nav email={user?.email ?? null} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-white/5 px-4 py-3 text-center text-xs text-sp-textSecondary">
        Driver Hub · Sacred Pathway · Cloud Sync dashboard
      </footer>
    </div>
  );
}
