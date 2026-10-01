// Auth callback: `next` validation + all session cookies on the redirect.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieCb = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: Record<string, unknown> }[]): void;
};

const SESSION_WRITE = [
  { name: "sb-test-auth-token.0", value: "chunk-0", options: { path: "/" } },
  { name: "sb-test-auth-token.1", value: "chunk-1", options: { path: "/" } },
];
const state = { error: null as null | { message: string } };

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: CookieCb }) => ({
    auth: {
      exchangeCodeForSession: async () => {
        if (!state.error) opts.cookies.setAll(SESSION_WRITE);
        return { error: state.error };
      },
      verifyOtp: async () => {
        if (!state.error) opts.cookies.setAll(SESSION_WRITE);
        return { error: state.error };
      },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "unit-test-anon-key";

const { GET } = await import("./route");
const ORIGIN = "https://app.sacredpathway.org";
const call = (qs: string) => GET(new NextRequest(new URL(`/auth/callback?${qs}`, ORIGIN)));

beforeEach(() => { state.error = null; });

describe("auth callback", () => {
  it("accepts next=/dashboard", async () => {
    const res = await call("code=abc&next=%2Fdashboard");
    expect(new URL(res.headers.get("location")!).toString()).toBe(`${ORIGIN}/dashboard`);
  });

  it("keeps a same-origin path with its query", async () => {
    const res = await call(`code=abc&next=${encodeURIComponent("/loads?status=pending")}`);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname + loc.search).toBe("/loads?status=pending");
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "rejects next=%s and falls back to /dashboard",
    async (next) => {
      for (const flow of ["code=abc", "token_hash=t&type=magiclink"]) {
        const res = await call(`${flow}&next=${encodeURIComponent(next)}`);
        const loc = new URL(res.headers.get("location")!);
        expect(loc.origin, flow).toBe(ORIGIN);
        expect(loc.pathname, flow).toBe("/dashboard");
      }
    },
  );

  it("defaults to /dashboard when next is absent", async () => {
    const res = await call("token_hash=t&type=email");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("puts EVERY session cookie chunk on the redirect", async () => {
    for (const flow of ["code=abc", "token_hash=t&type=magiclink"]) {
      const res = await call(flow);
      expect(res.cookies.get("sb-test-auth-token.0")?.value, flow).toBe("chunk-0");
      expect(res.cookies.get("sb-test-auth-token.1")?.value, flow).toBe("chunk-1");
    }
  });

  it("sends auth errors back to sign-in", async () => {
    state.error = { message: "bad code" };
    const res = await call("code=abc&next=%2Fdashboard");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/auth/signin");
    expect(loc.searchParams.get("error")).toBe("bad code");
  });
});
