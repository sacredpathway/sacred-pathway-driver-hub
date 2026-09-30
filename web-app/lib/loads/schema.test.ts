import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOADS_PRODUCTION_COLUMNS, UnknownLoadColumnError, assertLoadColumns, unknownLoadColumns } from "./schema";

const contractPath = fileURLToPath(new URL("../../../supabase/schema-contract/loads.columns.json", import.meta.url));

describe("loads schema contract", () => {
  it("matches supabase/schema-contract/loads.columns.json exactly", () => {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as { columns: string[] };
    expect([...LOADS_PRODUCTION_COLUMNS].sort()).toEqual([...contract.columns].sort());
  });

  it("rejects columns production does not have", () => {
    const row = { load_number: "1", broker_contact_name: "x", some_new_column: 1 };
    expect(unknownLoadColumns(row)).toEqual(["broker_contact_name", "some_new_column"]);
    expect(() => assertLoadColumns(row, "test")).toThrow(UnknownLoadColumnError);
    expect(() => assertLoadColumns(row, "test")).toThrow(/broker_contact_name, some_new_column/);
  });

  it("passes rows made only of real columns, unchanged", () => {
    const row = { load_number: "1", truck_id: null, status: "assigned" };
    expect(assertLoadColumns(row, "test")).toBe(row);
  });
});
