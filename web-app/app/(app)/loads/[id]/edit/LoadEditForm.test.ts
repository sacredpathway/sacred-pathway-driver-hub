import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Client component bound to a server action (React 19 useActionState), so it
// is checked at the source level; persistence is covered by payloads.test.ts
// and the action wiring below.
const form = readFileSync(join(__dirname, "LoadEditForm.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "..", "..", "actions.ts"), "utf8");

function updateActionSource(): string {
  const start = actions.indexOf("export async function updateLoadAction(");
  const end = actions.indexOf("export async function", start + 10);
  return actions.slice(start, end === -1 ? undefined : end);
}

describe("Edit Load form — no operational status selector", () => {
  it("has no status control of any kind", () => {
    expect(form).not.toMatch(/name=["']status["']/);
    expect(form).not.toMatch(/label=["']Status["']/);
    expect(form).not.toMatch(/statusOptionsFor|LOAD_STATUS_OPTIONS|loadStatusLabel/);
  });

  it("does not add a Delivered checkbox or other replacement", () => {
    expect(form).not.toMatch(/Delivered/i);
    expect(form).not.toMatch(/type=["']checkbox["']/);
  });

  it("keeps every paperwork field", () => {
    for (const name of [
      "load_number", "broker_name", "broker_mc_number", "origin", "destination", "pickup_date",
      "delivery_date", "total_miles", "line_haul_rate", "fuel_surcharge", "accessorial_charges",
      "total_revenue", "truck_id", "trailer_id",
    ]) {
      expect(form, name).toMatch(new RegExp(`name=["']${name}["']`));
    }
  });
});

describe("updateLoadAction never writes status", () => {
  const src = updateActionSource();

  it("builds its update from buildUpdateLoadPayload (which has no status key)", () => {
    expect(src).toContain("buildUpdateLoadPayload(formData)");
    expect(src).toContain('.update(assertLoadColumns(payload, "updateLoadAction"))');
  });

  it("does not read, gate or pass a status value", () => {
    expect(src).not.toMatch(/formData,\s*["']status["']/);
    expect(src).not.toMatch(/status:/);
    expect(src).not.toMatch(/isAllowedStatusWrite|NEW_LOAD_STATUS|ready_for_settlement/);
  });
});
