import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNext } from "./safeNext";

describe("safeNext", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/loads?status=pending&page=2", "/loads?status=pending&page=2"],
    ["/payroll/abc#top", "/payroll/abc#top"],
    ["/reports/revenue/csv", "/reports/revenue/csv"],
  ])("accepts same-origin path %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "//evil.example",
    "//evil.example/dashboard",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "https://evil.example/dashboard",
    "http:evil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    " /dashboard",
    "/\t/evil.example",
    "/\n/evil.example",
    "/" + "a".repeat(3000),
  ])("rejects %j and falls back to /dashboard", (input) => {
    const out = safeNext(input as string | null | undefined);
    expect(out).toBe(DEFAULT_NEXT);
  });

  it("never returns a value that resolves off-origin", () => {
    for (const v of ["/a", "//b", "/\\c", "https://d", "/e?x=//f"]) {
      const u = new URL(safeNext(v), "https://app.sacredpathway.org");
      expect(u.origin, v).toBe("https://app.sacredpathway.org");
    }
  });

  it("honours a custom fallback", () => {
    expect(safeNext("//x", "/")).toBe("/");
  });
});
