// Sign-out must end only this browser session (scope "local").
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieCb = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: Record<string, unknown> }[]): void;
};
const calls: unknown[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: CookieCb }) => ({
    auth: {
      signOut: async (options?: unknown) => {
        calls.push(options);
        opts.cookies.setAll([
          { name: "sb-test-auth-token.0", value: "", options: { path: "/", maxAge: 0 } },
          { name: "sb-test-auth-token.1", value: "", options: { path: "/", maxAge: 0 } },
        ]);
        return { error: null };
      },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "unit-test-anon-key";

const { POST } = await import("./route");

describe("sign-out", () => {
  it("uses local scope and clears every session chunk", async () => {
    const res = await POST(new NextRequest("https://app.sacredpathway.org/auth/signout", { method: "POST" }));
    expect(calls).toEqual([{ scope: "local" }]);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/sb-test-auth-token\.0=;/);
    expect(setCookie).toMatch(/sb-test-auth-token\.1=;/);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});
