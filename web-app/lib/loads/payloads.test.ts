import { describe, expect, it } from "vitest";
import { buildCreateLoadPayload } from "./payloads";
import { FieldError } from "./formFields";
import { LOADS_PRODUCTION_COLUMNS, unknownLoadColumns } from "./schema";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

// Every field the New Load form can submit (NewLoadForm.tsx).
const FULL = {
  load_number: "451223",
  status: "assigned",
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
    expect(payload.status).toBe("assigned");
  });

  it("defaults status to unassigned and rejects cancelled / invalid input", () => {
    expect(buildCreateLoadPayload(form({ load_number: "1" })).payload.status).toBe("unassigned");
    expect(() => buildCreateLoadPayload(form({ status: "cancelled" }))).toThrow(FieldError);
    expect(() => buildCreateLoadPayload(form({ pickup_date: "09/28/2026" }))).toThrow(FieldError);
    expect(() => buildCreateLoadPayload(form({ total_miles: "-5" }))).toThrow(FieldError);
    expect(() => buildCreateLoadPayload(form({ driver_id: "not-a-uuid" }))).toThrow(FieldError);
  });
});
