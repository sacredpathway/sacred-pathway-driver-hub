import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveBrokerContact, type BrokerContactInput } from "./contact";

type Op = { table: string; op: string; args: unknown[] };

/** Minimal chainable fake of the supabase-js query builder. */
function fakeSupabase(responses: Record<string, unknown>) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      let kind = "select";
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => (...args: unknown[]) => {
        ops.push({ table, op, args });
        if (op === "insert" || op === "update") kind = op;
        return builder;
      };
      for (const op of ["select", "eq", "limit", "insert", "update", "single"]) builder[op] = chain(op);
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(responses[`${table}.${kind}`] ?? { data: null, error: null });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

const INPUT: BrokerContactInput = {
  brokerName: "Acme Logistics LLC", mcNumber: "123456",
  contactName: "Aaron", phone: "(555) 555-0123", phoneExtension: "202", email: "a@acme.test",
};

describe("saveBrokerContact — writes only to brokers / broker_contacts", () => {
  it("creates broker + contact when neither exists (never touches loads)", async () => {
    const { client, ops } = fakeSupabase({
      "brokers.select": { data: [], error: null },
      "brokers.insert": { data: { id: "b1" }, error: null },
      "broker_contacts.select": { data: [], error: null },
      "broker_contacts.insert": { data: { id: "c1" }, error: null },
    });
    const r = await saveBrokerContact(client, "p1", INPUT);
    expect(r).toEqual({ status: "saved", brokerId: "b1", contactId: "c1" });
    expect(ops.some((o) => o.table === "loads")).toBe(false);
    const brokerInsert = ops.find((o) => o.table === "brokers" && o.op === "insert")!.args[0];
    expect(brokerInsert).toMatchObject({ profile_id: "p1", broker_name: "Acme Logistics LLC",
                                         normalized_name: "acme", mc_number: "123456" });
    const contactInsert = ops.find((o) => o.table === "broker_contacts" && o.op === "insert")!.args[0];
    expect(contactInsert).toMatchObject({ broker_id: "b1", contact_name: "Aaron",
                                          phone: "(555) 555-0123 x202", email: "a@acme.test" });
  });

  it("reuses an existing broker/contact and only fills empty fields", async () => {
    const { client, ops } = fakeSupabase({
      "brokers.select": { data: [{ id: "b9", mc_number: "999" }], error: null },
      "broker_contacts.select": { data: [{ id: "c9", email: "keep@acme.test", phone: null }], error: null },
      "broker_contacts.update": { data: null, error: null },
    });
    const r = await saveBrokerContact(client, "p1", INPUT);
    expect(r).toEqual({ status: "saved", brokerId: "b9", contactId: "c9" });
    expect(ops.some((o) => o.table === "brokers" && o.op === "insert")).toBe(false);
    expect(ops.some((o) => o.table === "brokers" && o.op === "update")).toBe(false); // MC already set
    const patch = ops.find((o) => o.table === "broker_contacts" && o.op === "update")!.args[0] as Record<string, string>;
    expect(patch.email).toBeUndefined();                  // never overwrite curated data
    expect(patch.phone).toBe("(555) 555-0123 x202");
  });

  it("skips when there is no broker or no rep detail", async () => {
    const { client, ops } = fakeSupabase({});
    expect(await saveBrokerContact(client, "p1", { ...INPUT, brokerName: null })).toEqual({ status: "skipped" });
    expect(await saveBrokerContact(client, "p1", { ...INPUT, contactName: null, phone: null, phoneExtension: null, email: null }))
      .toEqual({ status: "skipped" });
    expect(ops).toEqual([]);
  });

  it("reports failure honestly instead of throwing", async () => {
    const { client } = fakeSupabase({ "brokers.select": { data: null, error: { message: "rls" } } });
    expect(await saveBrokerContact(client, "p1", INPUT)).toEqual({ status: "failed", step: "broker", error: "rls" });
  });
});
