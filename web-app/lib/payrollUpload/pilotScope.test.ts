import { describe, expect, it } from "vitest";
import { autoLoadCreationEnabled, payrollConfirmGate } from "./featureFlag";

const prod = "https://rmzqxsfhjqrshhdjzhze.supabase.co";
const PILOT = "23585e59-b6a2-41ce-9e44-c8b848ba16ff";
const OTHER = "5b65ef4c-cf90-45a3-9df0-4e9d98300a7e";
const env = {
  NEXT_PUBLIC_SUPABASE_URL: prod, SMART_PAYROLL_CONFIRM: "production", SMART_PAYROLL_PRODUCTION_ACK: "rmzqxsfhjqrshhdjzhze",
  SMART_PAYROLL_PILOT_PROFILES: PILOT, SMART_PAYROLL_PILOT_UNTIL: "2026-11-02T15:00:00Z", SMART_LOAD_AUTO_CREATE: "off",
};

describe("production pilot scope (one carrier, fixed end)", () => {
  it("on for the pilot carrier before the end time", () => {
    expect(payrollConfirmGate(env, { profileId: PILOT, now: new Date("2026-10-27T00:00:00Z") })).toEqual({ enabled: true, reason: "enabled_production" });
  });
  it("off for every other carrier and when no carrier is known", () => {
    expect(payrollConfirmGate(env, { profileId: OTHER, now: new Date("2026-10-27T00:00:00Z") }).reason).toBe("pilot_not_included");
    expect(payrollConfirmGate(env, { now: new Date("2026-10-27T00:00:00Z") }).reason).toBe("pilot_not_included");
  });
  it("turns itself off at the end time, with no deploy", () => {
    expect(payrollConfirmGate(env, { profileId: PILOT, now: new Date("2026-11-02T14:59:59Z") }).enabled).toBe(true);
    expect(payrollConfirmGate(env, { profileId: PILOT, now: new Date("2026-11-02T15:00:00Z") }).reason).toBe("pilot_expired");
  });
  it("profile list is case-insensitive and ignores junk entries", () => {
    expect(payrollConfirmGate({ ...env, SMART_PAYROLL_PILOT_PROFILES: ` x, ${PILOT.toUpperCase()} ,` }, { profileId: PILOT, now: new Date("2026-10-27T00:00:00Z") }).enabled).toBe(true);
    expect(payrollConfirmGate({ ...env, SMART_PAYROLL_PILOT_PROFILES: "*" }, { profileId: PILOT, now: new Date("2026-10-27T00:00:00Z") }).enabled).toBe(false);
  });
  it("automatic load creation stays off with SMART_LOAD_AUTO_CREATE=off, even for the pilot carrier", () => {
    expect(autoLoadCreationEnabled(env, { profileId: PILOT, now: new Date("2026-10-27T00:00:00Z") })).toBe(false);
  });
  it("local / staging modes are unaffected by the pilot variables", () => {
    expect(payrollConfirmGate({ SMART_PAYROLL_CONFIRM: "staging-only", NEXT_PUBLIC_SUPABASE_URL: "https://aatkirzwuuegurdlmcpl.supabase.co" }).enabled).toBe(true);
  });
});
