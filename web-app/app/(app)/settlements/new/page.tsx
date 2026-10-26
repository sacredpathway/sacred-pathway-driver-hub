// /settlements/new — start a settlement (driver → period → loads → create)
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewSettlementForm from "./NewSettlementForm";

export default async function NewSettlementPage({ searchParams }: { searchParams: Promise<{ driver?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("drivers").select("id, name, active").order("name");
  const drivers = ((data ?? []) as Array<{ id: string; name: string; active: boolean | null }>).filter((d) => d.active !== false);
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sp-gold/90">Settlements</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">New settlement</h1>
          <p className="mt-1 text-sm text-sp-textSecondary">Pick the driver and week. Delivered loads are pulled in; you can edit everything on the next screen.</p>
        </div>
        <Link href="/settlements" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">Cancel</Link>
      </header>
      {drivers.length === 0 ? (
        <p className="rounded-xl border border-white/5 bg-sp-card p-4 text-sm text-sp-textSecondary">Add a driver first. <Link href="/drivers/new" className="text-sp-gold hover:underline">Add driver</Link></p>
      ) : (
        <NewSettlementForm drivers={drivers.map((d) => ({ id: d.id, name: d.name }))} initialDriverId={drivers.some((d) => d.id === sp.driver) ? sp.driver! : drivers[0].id} />
      )}
    </section>
  );
}
