// /settings/payroll-categories — manage the carrier's own payroll categories
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listCustomCategories } from "@/lib/settlements/server";
import CategoriesManager from "./CategoriesManager";

export default async function PayrollCategoriesPage() {
  const supabase = await createClient();
  const { available, categories } = await listCustomCategories(supabase);
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll categories</h1>
          <p className="mt-1 text-xs text-sp-textSecondary">Your own addition and deduction categories for settlements (e.g. “ELD subscription”, “Phone stipend”).</p>
        </div>
        <Link href="/settings" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5">← Settings</Link>
      </header>
      {!available ? (
        <div className="rounded-xl border border-sp-warning/40 bg-sp-warning/10 p-4 text-sm text-orange-100">
          <p className="font-semibold">Saved categories need a database update that hasn’t been applied yet.</p>
          <p className="mt-1 text-xs">
            Until then you can still type any category name on a settlement line (“+ New category…”). It saves as an “Other” line with that name, and
            names you’ve used are offered again. After the update, those become reusable categories you can rename and archive here.
          </p>
        </div>
      ) : (
        <CategoriesManager initial={categories} />
      )}
    </section>
  );
}
