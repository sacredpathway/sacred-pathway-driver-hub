import { describe, expect, it } from "vitest";
import { buildCreateLoadPayload, buildUpdateLoadPayload } from "./payloads";
import { FieldError } from "./formFields";
import { LOADS_PRODUCTION_COLUMNS, unknownLoadColumns } from "./schema";
import { NEW_LOAD_STATUS, isCancelledStatus, loadStatusGroup, settlementEligibility } from "./status";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

// Every field the New Load form can submit (NewLoadForm.tsx). No status —
// the form has no status control any more (entered load = delivered load).
const FULL = {
  load_number: "451223",
  broker_name: "Acme Logistics LLC",
  broker_mc_number: "123456",
  broker_contact_name: "Aaron Dini",
  broker_contact_phone: "(555) 555-0123",
  broker_phone_extension: "x202",
  broker_contact_email: "aaron@acme.test",
  origin: "Tuscaloosa, AL",
  destination: "Bernalillo, NM",
  pickup_date: "2026-09-28",
  delivery_date: "2026-09-30",
  total_miles: "1,210",
  line_haul_rate: "$2,400",
  fuel_surcharge: "150",
  accessorial_charges: "75",
  total_revenue: "",
  driver_id: "11111111-2222-4333-8444-555555555555",
  truck_id: "AAAAAAAA-2222-4333-8444-555555555555",
  trailer_id: "",
};

describe("buildCreateLoadPayload — New Load insert contract", () => {
  it("insert row contains ONLY production loads columns", () => {
    const { payload } = buildCreateLoadPayload(form(FULL));
    const row = { ...payload, profile_id: "00000000-0000-4000-8000-000000000000" };
    expect(unknownLoadColumns(row)).toEqual([]);
    for (const k of Object.keys(row)) expect(LOADS_PRODUCTION_COLUMNS).toContain(k);
  });

  it("never puts broker rep fields on the load", () => {
    const { payload } = buildCreateLoadPayload(form(FULL));
    for (const k of ["broker_contact_name", "broker_contact_phone", "broker_phone_extension",
                     "broker_contact_email", "broker_id", "broker_contact_id"]) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it("keeps rep details for brokers / broker_contacts instead of dropping them", () => {
    const { brokerContact } = buildCreateLoadPayload(form(FULL));
    expect(brokerContact).toEqual({
      brokerName: "Acme Logistics LLC",
      mcNumber: "123456",
      contactName: "Aaron Dini",
      phone: "(555) 555-0123",
      phoneExtension: "x202",
      email: "aaron@acme.test",
    });
  });

  it("keeps existing parsing behaviour", () => {
    const { payload } = buildCreateLoadPayload(form(FULL));
    expect(payload.total_miles).toBe(1210);
    expect(payload.line_haul_rate).toBe(2400);
    expect(payload.total_revenue).toBe(2625);           // auto-sum when blank
    expect(payload.truck_id).toBe("aaaaaaaa-2222-4333-8444-555555555555");
    expect(payload.trailer_id).toBeNull();
  });

  it("rejects invalid paperwork input (unchanged validation)", () => {
    expect(() => buildCreateLoadPayload(form({ pickup_date: "09/28/2026" }))).toThrow(FieldError);
    expect(() => buildCreateLoadPayload(form({ total_miles: "-5" }))).toThrow(FieldError);
    expect(() => buildCreateLoadPayload(form({ driver_id: "not-a-uuid" }))).toThrow(FieldError);
  });
});

describe("New Load status — entered load = delivered load", () => {
  it("every new load is saved as ready_for_settlement", () => {
    expect(NEW_LOAD_STATUS).toBe("ready_for_settlement");
    expect(buildCreateLoadPayload(form(FULL)).payload.status).toBe(NEW_LOAD_STATUS);
    expect(buildCreateLoadPayload(form({ load_number: "1" })).payload.status).toBe(NEW_LOAD_STATUS);
  });

  it("ignores any submitted status — the user can't pick one, and a crafted post can't either", () => {
    for (const st of ["unassigned", "assigned", "in_transit", "picked_up", "delivered", "settled", "cancelled", "junk"]) {
      expect(buildCreateLoadPayload(form({ ...FULL, status: st })).payload.status).toBe(NEW_LOAD_STATUS);
    }
  });

  it("the insert still contains only production columns with the status set", () => {
    const { payload } = buildCreateLoadPayload(form(FULL));
    expect(unknownLoadColumns({ ...payload, profile_id: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
    expect(Object.keys(payload)).toContain("status");
  });
});

// Everything the Edit Load form submits (LoadEditForm.tsx).
const EDIT = {
  load_number: "451223",
  broker_name: "Acme Logistics LLC",
  broker_mc_number: "123456",
  origin: "Tuscaloosa, AL",
  destination: "Bernalillo, NM",
  pickup_date: "2026-09-28",
  delivery_date: "2026-09-30",
  total_miles: "1,210",
  line_haul_rate: "$2,400",
  fuel_surcharge: "150",
  accessorial_charges: "75",
  total_revenue: "2625",
  truck_id: "AAAAAAAA-2222-4333-8444-555555555555",
  trailer_id: "",
};

/** What the row's status is after `.update(payload)`: Postgres keeps any column the payload omits. */
function statusAfterEdit(stored: string | null, submitted?: string): string | null {
  const payload = buildUpdateLoadPayload(form(submitted === undefined ? EDIT : { ...EDIT, status: submitted }));
  return "status" in payload ? (payload as Record<string, unknown>).status as string | null : stored;
}

describe("Edit Load — existing status is preserved", () => {
  it("the update payload has no status key, even if a status is posted", () => {
    expect(buildUpdateLoadPayload(form(EDIT))).not.toHaveProperty("status");
    for (const st of ["ready_for_settlement", "settled", "unassigned", "cancelled", "junk"]) {
      expect(buildUpdateLoadPayload(form({ ...EDIT, status: st }))).not.toHaveProperty("status");
    }
  });

  it("the update contains only production loads columns", () => {
    expect(unknownLoadColumns(buildUpdateLoadPayload(form(EDIT)))).toEqual([]);
  });

  it("every historical status survives an edit unchanged", () => {
    for (const stored of ["pending", "unassigned", "assigned", "in_transit", "delivered",
                          "ready_for_settlement", "settled", "cancelled", "on_hold", null]) {
      expect(statusAfterEdit(stored, "ready_for_settlement")).toBe(stored);
      expect(statusAfterEdit(stored)).toBe(stored);
    }
  });

  it("editing an old pending load does not make it payable", () => {
    const after = statusAfterEdit("pending");
    expect(after).toBe("pending");
    expect(after).not.toBe(NEW_LOAD_STATUS);
    expect(settlementEligibility(after)).toBe("after_delivery_date"); // unchanged rule
  });

  it("editing a ready_for_settlement load keeps it ready", () => {
    expect(statusAfterEdit("ready_for_settlement", "unassigned")).toBe("ready_for_settlement");
  });

  it("editing a settled (paid) load can't make it payable again", () => {
    const after = statusAfterEdit("settled", "ready_for_settlement");
    expect(after).toBe("settled");
    expect(loadStatusGroup(after)).toBe("settled");
  });

  it("editing a cancelled load keeps it cancelled (never payable)", () => {
    const after = statusAfterEdit("cancelled", "ready_for_settlement");
    expect(isCancelledStatus(after)).toBe(true);
    expect(settlementEligibility(after)).toBe("never");
  });

  it("paperwork parsing and validation are unchanged", () => {
    const p = buildUpdateLoadPayload(form(EDIT));
    expect(p.total_miles).toBe(1210);
    expect(p.line_haul_rate).toBe(2400);
    expect(p.total_revenue).toBe(2625);
    expect(p.truck_id).toBe("aaaaaaaa-2222-4333-8444-555555555555");
    expect(p.trailer_id).toBeNull();
    expect(() => buildUpdateLoadPayload(form({ ...EDIT, pickup_date: "09/28/2026" }))).toThrow(FieldError);
    expect(() => buildUpdateLoadPayload(form({ ...EDIT, total_miles: "-5" }))).toThrow(FieldError);
    expect(() => buildUpdateLoadPayload(form({ ...EDIT, truck_id: "not-a-uuid" }))).toThrow(FieldError);
  });

  it("New Load still always saves ready_for_settlement", () => {
    expect(buildCreateLoadPayload(form({ load_number: "1" })).payload.status).toBe(NEW_LOAD_STATUS);
  });
});
