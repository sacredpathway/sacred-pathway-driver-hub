import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The form is a client component bound to a server action (React 19
// useActionState), so it is checked at the source level here; the saved
// value is covered by lib/loads/payloads.test.ts.
const src = readFileSync(join(__dirname, "NewLoadForm.tsx"), "utf8");

describe("New Load form — no status decision", () => {
  it("has no status control of any kind", () => {
    expect(src).not.toMatch(/name=["']status["']/);
    expect(src).not.toMatch(/label=["']Status["']/);
    expect(src).not.toMatch(/LOAD_STATUS_OPTIONS|statusOptionsFor|loadStatusLabel/);
  });

  it("does not add a visible Delivered field instead", () => {
    expect(src).not.toMatch(/label=["'][^"']*Delivered[^"']*["']/i);
  });

  it("keeps every paperwork field", () => {
    for (const name of [
      "load_number", "broker_name", "broker_mc_number", "broker_contact_name", "broker_contact_phone",
      "broker_phone_extension", "broker_contact_email", "origin", "destination", "pickup_date",
      "delivery_date", "total_miles", "line_haul_rate", "fuel_surcharge", "accessorial_charges",
      "total_revenue", "driver_id", "truck_id", "trailer_id",
    ]) {
      expect(src, name).toMatch(new RegExp(`name=["']${name}["']`));
    }
  });
});
