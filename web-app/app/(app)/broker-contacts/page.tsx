import { createClient } from "@/lib/supabase/server";
import EmptyState from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import type { BrokerContact, Broker } from "@/lib/supabase/types";

export const runtime = "edge";

export default async function BrokerContactsPage() {
  const supabase = await createClient();
  // Two queries instead of a join — keeps RLS auditing trivial and lets
  // us cap each list independently if the dataset balloons.
  const [{ data: contacts }, { data: brokers }] = await Promise.all([
    supabase.from("broker_contacts").select("*").order("last_interaction_at", { ascending: false }),
    supabase.from("brokers").select("id,broker_name,mc_number"),
  ]);

  const list = (contacts ?? []) as BrokerContact[];
  const brokerMap = new Map<string, Pick<Broker, "broker_name" | "mc_number">>();
  for (const b of (brokers ?? []) as Broker[]) {
    brokerMap.set(b.id, { broker_name: b.broker_name, mc_number: b.mc_number });
  }

  if (list.length === 0) {
    return (
      <EmptyState
        title="No broker contacts yet"
        body="Contacts saved from rate-cons or added in the iPhone app appear here."
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Broker Contacts</h1>
        <span className="text-xs text-sp-textSecondary">{list.length} total</span>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-sp-card text-left text-xs uppercase tracking-wide text-sp-textSecondary">
            <tr>
              <th className="px-3 py-3">Contact</th>
              <th className="px-3 py-3">Broker</th>
              <th className="hidden px-3 py-3 md:table-cell">Phone</th>
              <th className="hidden px-3 py-3 md:table-cell">Email</th>
              <th className="hidden px-3 py-3 lg:table-cell">Last touch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-sp-card/30">
            {list.map((c) => {
              const b = brokerMap.get(c.broker_id);
              const phone = c.phone
                ? c.phone_extension
                  ? `${c.phone} · ext ${c.phone_extension}`
                  : c.phone
                : "—";
              return (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-3 py-3 font-medium text-sp-textPrimary">{c.contact_name}</td>
                  <td className="px-3 py-3 text-sp-textSecondary">{b?.broker_name ?? "—"}</td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">{phone}</td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary md:table-cell">{c.email ?? "—"}</td>
                  <td className="hidden px-3 py-3 text-sp-textSecondary lg:table-cell">
                    {formatDate(c.last_interaction_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
