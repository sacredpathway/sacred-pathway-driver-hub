import { describe, expect, it } from "vitest";
import { initialMobileNavState, mobileNavReducer, type MobileNavState } from "./mobileNav";

describe("mobile navigation drawer state", () => {
  const closed = initialMobileNavState("/dashboard");

  it("starts closed", () => {
    expect(closed).toEqual({ open: false, pathname: "/dashboard" });
  });

  it("toggle opens and closes", () => {
    const open = mobileNavReducer(closed, { type: "toggle" });
    expect(open.open).toBe(true);
    expect(mobileNavReducer(open, { type: "toggle" }).open).toBe(false);
  });

  it("escape, close button and backdrop close it", () => {
    const open: MobileNavState = { open: true, pathname: "/dashboard" };
    expect(mobileNavReducer(open, { type: "escape" }).open).toBe(false);
    expect(mobileNavReducer(open, { type: "close" }).open).toBe(false);
  });

  it("navigating to another route closes it", () => {
    const open: MobileNavState = { open: true, pathname: "/dashboard" };
    expect(mobileNavReducer(open, { type: "route_change", pathname: "/loads" })).toEqual({ open: false, pathname: "/loads" });
  });

  it("same-route and already-closed events are no-ops (same object)", () => {
    const open: MobileNavState = { open: true, pathname: "/dashboard" };
    expect(mobileNavReducer(open, { type: "route_change", pathname: "/dashboard" })).toBe(open);
    expect(mobileNavReducer(closed, { type: "escape" })).toBe(closed);
    expect(mobileNavReducer(open, { type: "open" })).toBe(open);
  });
});
