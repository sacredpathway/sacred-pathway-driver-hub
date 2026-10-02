import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_DOCUMENT_TYPES,
  documentTypeLabel,
  normalizeDocumentType,
  routableDocumentType,
  storedValuesForType,
} from "./taxonomy";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("one shared taxonomy (web copy === Edge Function canonical)", () => {
  it("taxonomy.ts is byte-identical to supabase/functions/_shared/document-taxonomy.ts", () => {
    expect(read("./taxonomy.ts")).toBe(read("../../../supabase/functions/_shared/document-taxonomy.ts"));
  });

  it("extraction.ts matches the Edge Function copy except the import specifier", () => {
    const deno = read("../../../supabase/functions/_shared/document-extraction.ts")
      .replace('from "./document-taxonomy.ts";', 'from "./taxonomy";');
    expect(read("./extraction.ts")).toBe(deno);
  });
});

describe("canonical types + compatibility mappings", () => {
  it("contains every required canonical type", () => {
    for (const t of [
      "rate_confirmation", "bol", "pod", "fuel_receipt", "lumper_fee", "toll", "repair",
      "cdl", "medical_card", "mvr", "other",
    ]) {
      expect(CANONICAL_DOCUMENT_TYPES).toContain(t);
    }
  });

  it.each([
    ["lumper", "lumper_fee"],
    ["Lumper Receipt", "lumper_fee"],
    ["fuel", "fuel_receipt"],
    ["maintenance", "repair"],
    ["rate-con", "rate_confirmation"],
    ["Bill of Lading", "bol"],
    ["proof_of_delivery", "pod"],
    ["med card", "medical_card"],
    ["motor_vehicle_record", "mvr"],
  ])("alias %s -> %s", (raw, expected) => {
    expect(normalizeDocumentType(raw)).toBe(expected);
  });

  it("keeps historical values displayable but never routable", () => {
    for (const legacy of ["paystub", "invoice", "receipt", "settlement"]) {
      expect(normalizeDocumentType(legacy)).toBe(legacy);
      expect(routableDocumentType(legacy)).toBe("other");
    }
    expect(documentTypeLabel("paystub")).toBe("Paystub");
  });

  it("unknown / empty / non-string -> other", () => {
    expect(normalizeDocumentType("passport")).toBe("other");
    expect(normalizeDocumentType("")).toBe("other");
    expect(normalizeDocumentType(null)).toBe("other");
    expect(normalizeDocumentType({ toString: () => "bol" })).toBe("other");
  });

  it("list filter finds old spellings without renaming rows", () => {
    expect(storedValuesForType("lumper_fee")).toEqual(expect.arrayContaining(["lumper_fee", "lumper", "lumper_receipt"]));
    expect(storedValuesForType("paystub")).toEqual(["paystub"]);
  });
});
