// Contract between the web app and sph_web_save_settlement:
//  1. every column the database function reads is present in what the app sends;
//  2. the payload the app builds for a realistic settlement is checked into
//     supabase/tests/web_settlements/generated/web_payload.json and executed
//     against the real function by the database suite (30_web_payload.sql).
//     If the app's payload changes, this test fails until the file is
//     regenerated (UPDATE_DB_FIXTURE=1 npx vitest run lib/settlements/contract.test.ts).
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { savePayload } from "./server";
import { headerEditRow, snapToStoredPrecision } from "./rows";
import { recalculate, lineFromLoad, audit } from "./workflow";
import type { SettlementBundle } from "./model";

const REPO = join(__dirname, "..", "..", "..");
const MIGRATION = readFileSync(join(REPO, "supabase/migrations/20261023130000_web_settlement_atomic_writes.sql"), "utf8");
const FIXTURE = join(REPO, "supabase/tests/web_settlements/generated/web_payload.json");

// Columns the function accepts only from the iPhone (2.3.7+). The web never
// sends them: absent header keys keep the stored value, and the line document
// links are written on INSERT only, so a web save can never clear them
// (proven by supabase/tests/web_settlements/40_ios_payload.sql).
const IPHONE_ONLY_HEADER = ["truck_id", "pdf_storage_path"];
const IPHONE_ONLY_LINE = ["document_id", "rate_confirmation_document_id", "proof_of_delivery_document_id"];

function upsertColumns(table: string): string[] {
  const m = new RegExp(`insert into public\\.${table} \\(([^)]+)\\)\\s+select`, "m").exec(MIGRATION);
  if (!m) throw new Error(`no upsert for ${table}`);
  return m[1].split(",").map((c) => c.trim()).filter((c) => !["id", "settlement_id", "profile_id", ...IPHONE_ONLY_LINE].includes(c)).concat("id");
}
function headerColumns(): string[] {
  return [...MIGRATION.matchAll(/(\w+) = case when v_hj \? '(\w+)'/g)].map((m) => m[2]).filter((c) => !IPHONE_ONLY_HEADER.includes(c));
}

function realisticBundle(): SettlementBundle {
  const A = "aaaaaaaa-0000-0000-0000-000000000001";
  const b: SettlementBundle = {
    header: {
      id: "5e000000-0000-4000-8000-0000000000ff", profileId: A, driverId: "aaaaaaaa-0000-0000-0000-00000000d001",
      periodStart: "2026-10-12", periodEnd: "2026-10-18", status: "draft", settlementNumber: "SP-2026-0901",
      settlementType: "company_driver", truckNumber: "12",
      payRule: { components: [{ id: "00000000-0000-4000-8000-000000000001", kind: "percent_of_gross", label: "Percentage of Gross", percent: "27.5", rate: null, mileBasis: "loaded", fixedAmount: null, hours: null }],
        feeTerms: { dispatcherFeePercent: "0", factoringFeePercent: "2.5", authorityFee: "0", maintenanceReserve: "0", dispatcherFeeResponsibility: "company", factoringFeeResponsibility: "company", authorityFeeResponsibility: "company", maintenanceReserveResponsibility: "company" } },
      payOnGrossRevenue: true, hoursWorked: null, notes: "Contract fixture", paymentMethod: null, paymentReference: null,
      driverPayPercentage: null, netPay: null, isEstimate: false, engineVersion: null, createdAt: null, updatedAt: null,
      approvedAt: null, approvedBy: null, paidAt: null, voidedAt: null, createdBy: A,
    },
    loadLines: [{ ...lineFromLoad({ id: "aaaaaaaa-0000-0000-0000-0000000a0001", driver_id: null, load_number: "L1", broker_name: "TQL", broker_mc_number: null, pickup_date: "2026-10-13", delivery_date: "2026-10-14", origin: "Dallas, TX", destination: "Phoenix, AZ", total_miles: 1065.4, empty_miles: 42, line_haul_rate: 2850.55, fuel_surcharge: 312.4, accessorial_charges: 75, total_revenue: 3237.95, status: "ready_for_settlement" }, 0), id: "f1000000-0000-4000-8000-000000000001" }],
    additions: [{ id: "f1000000-0000-4000-8000-0000000000a1", category: "other", customCategoryId: null, description: "Phone stipend", amount: "25.00", date: null, relatedLoadId: null, documentId: null, notes: null, sortOrder: 0, createdAt: null }],
    deductions: [{ id: "f1000000-0000-4000-8000-0000000000d1", category: "repair", customCategoryId: null, description: "Tire", amount: "333.33", date: null, relatedLoadId: null, relatedExpenseId: null, documentId: null, notes: null, responsibility: "split", driverSharePercent: "33.333", recurringDeductionId: null, advanceId: null, sortOrder: 2000, createdAt: null }],
  };
  return b;
}

function buildPayload() {
  const { bundle, totals, result } = recalculate(snapToStoredPrecision(realisticBundle()));
  const p = savePayload({
    mode: "create", bundle,
    headerRow: { ...headerEditRow(bundle.header, totals, "company_driver"), driver_id: bundle.header.driverId },
    expectedUpdatedAt: null,
    audit: [audit.created("Driver A1", "Oct 12 – Oct 18, 2026 · SP-2026-0901")],
    actorName: "owner@example.com",
  });
  return { p, net: result.netDriverPay };
}

describe("web ↔ database contract", () => {
  it("every column the save function reads is sent by the app", () => {
    const { p } = buildPayload();
    const header = p.header as Record<string, unknown>;
    for (const c of headerColumns()) expect(Object.keys(header), `header.${c}`).toContain(c);
    for (const [table, key] of [["settlement_loads", "loads"], ["settlement_additions", "additions"], ["settlement_deductions", "deductions"]] as const) {
      const rows = p[key] as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const c of upsertColumns(table)) expect(Object.keys(rows[0]), `${key}.${c}`).toContain(c);
    }
  });

  it("the checked-in payload the database suite executes is what the app builds today", () => {
    const { p, net } = buildPayload();
    expect(net.toFixed2()).toBe("804.33"); // 27.5% × 3,237.95 = 890.44 + 25.00 − 111.11 (driver share of the split repair)
    const json = JSON.stringify(p, null, 2) + "\n";
    if (process.env.UPDATE_DB_FIXTURE === "1") {
      mkdirSync(join(FIXTURE, ".."), { recursive: true });
      writeFileSync(FIXTURE, json);
    }
    expect(readFileSync(FIXTURE, "utf8")).toBe(json);
  });
});
