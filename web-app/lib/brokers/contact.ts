// =============================================================================
//  Persist a load's broker + rep into the EXISTING normalized tables
// -----------------------------------------------------------------------------
//  Production has no broker/contact columns on `loads`. The supported model
//  (same as iOS Smart Scan):
//    brokers          (profile_id, broker_name, normalized_name, mc_number)
//    broker_contacts  (broker_id, contact_name, email, phone)
//  A load links to its broker through `loads.broker_name` text. A phone
//  extension is kept inside `broker_contacts.phone` as "… x<ext>" (iOS
//  convention) — there is no extension column.
//
//  Behaviour mirrors iOS autoAddBrokerContact: find broker by normalized
//  name (else create), backfill a missing MC #, find contact by exact name
//  (else create), fill only EMPTY email/phone on an existing contact.
//  Never throws: returns what was actually persisted so the caller can be
//  honest with the user.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { combineBrokerPhone, normalizeBrokerName } from "./normalize";

export interface BrokerContactInput {
  brokerName: string | null;
  mcNumber: string | null;
  contactName: string | null;
  phone: string | null;
  phoneExtension: string | null;
  email: string | null;
}

export type BrokerContactResult =
  | { status: "skipped" }                                   // no broker/contact info given
  | { status: "saved"; brokerId: string; contactId: string | null }
  | { status: "failed"; step: "broker" | "contact"; error: string };

export function hasContactDetails(i: BrokerContactInput): boolean {
  return Boolean(i.contactName || i.phone || i.phoneExtension || i.email);
}

export async function saveBrokerContact(
  supabase: SupabaseClient,
  profileId: string,
  input: BrokerContactInput,
): Promise<BrokerContactResult> {
  const brokerName = input.brokerName?.trim() || null;
  if (!brokerName || !hasContactDetails(input)) return { status: "skipped" };

  try {
    // 1) broker
    const normalized = normalizeBrokerName(brokerName);
    const { data: found, error: findErr } = await supabase
      .from("brokers")
      .select("id, mc_number")
      .eq("profile_id", profileId)
      .eq("normalized_name", normalized)
      .limit(1);
    if (findErr) return { status: "failed", step: "broker", error: findErr.message };

    let brokerId: string;
    const existing = (found ?? [])[0] as { id: string; mc_number: string | null } | undefined;
    if (existing) {
      brokerId = existing.id;
      if (!existing.mc_number && input.mcNumber) {
        await supabase.from("brokers").update({ mc_number: input.mcNumber }).eq("id", brokerId);
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from("brokers")
        .insert({
          profile_id: profileId,
          broker_name: brokerName,
          normalized_name: normalized,
          mc_number: input.mcNumber,
          total_loads: 0,
          total_revenue: 0,
        })
        .select("id")
        .single();
      if (createErr || !created) {
        return { status: "failed", step: "broker", error: createErr?.message ?? "no row returned" };
      }
      brokerId = (created as { id: string }).id;
    }

    // 2) contact — iOS falls back to the company name when no rep name
    const contactName = input.contactName?.trim() || brokerName;
    const phone = combineBrokerPhone(input.phone, input.phoneExtension);
    const email = input.email?.trim() || null;

    const { data: contacts, error: cFindErr } = await supabase
      .from("broker_contacts")
      .select("id, email, phone")
      .eq("broker_id", brokerId)
      .eq("contact_name", contactName)
      .limit(1);
    if (cFindErr) return { status: "failed", step: "contact", error: cFindErr.message };

    const current = (contacts ?? [])[0] as
      | { id: string; email: string | null; phone: string | null }
      | undefined;
    const now = new Date().toISOString();
    if (current) {
      const patch: Record<string, string> = { last_interaction_at: now };
      if (!current.email && email) patch.email = email;
      if (!current.phone && phone) patch.phone = phone;
      const { error } = await supabase.from("broker_contacts").update(patch).eq("id", current.id);
      if (error) return { status: "failed", step: "contact", error: error.message };
      return { status: "saved", brokerId, contactId: current.id };
    }

    const { data: newContact, error: cErr } = await supabase
      .from("broker_contacts")
      .insert({ broker_id: brokerId, contact_name: contactName, email, phone, last_interaction_at: now })
      .select("id")
      .single();
    if (cErr || !newContact) {
      return { status: "failed", step: "contact", error: cErr?.message ?? "no row returned" };
    }
    return { status: "saved", brokerId, contactId: (newContact as { id: string }).id };
  } catch (e) {
    return { status: "failed", step: "broker", error: (e as Error).message };
  }
}
