// Regression tests for the sign-in gate (middleware.ts).
//
// Added with the Next.js 15.0.7 -> 15.5.26 security upgrade
// (GHSA-f82v-jwr5-mffw middleware authorization bypass and later
// middleware/proxy advisories). Supabase is mocked: each test decides whether
// auth.getUser() returns a user and whether it "refreshes" cookies.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieCb = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: Record<string, unknown> }[]): void;
};

// What a real @supabase/ssr refresh writes in ONE setAll() call: the new
// session split across two chunks, plus removal of a stale unchunked cookie.
const REFRESH_WRITE = [
  { name: "sb-test-auth-token.0", value: "new-chunk-0", options: { path: "/" } },
  { name: "sb-test-auth-token.1", value: "new-chunk-1", options: { path: "/" } },
  { name: "sb-test-auth-token", value: "", options: { path: "/", maxAge: 0 } },
];

const auth = {
  user: null as null | { id: string },
  refresh: false,
  calls: 0,
  seenCookies: [] as Array<string | undefined>,
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: CookieCb }) => ({
    auth: {
      getUser: async () => {
        auth.calls++;
        auth.seenCookies.push(
          opts.cookies.getAll().find((c) => c.name === "sb-test-auth-token")?.value,
        );
        if (auth.refresh) {
          opts.cookies.setAll(REFRESH_WRITE);
        }
        return { data: { user: auth.user } };
      },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "unit-test-anon-key";

const { middleware, config } = await import("./middleware");

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://app.sacredpathway.org"), { headers });
}

function signinTarget(res: Response) {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const u = new URL(loc);
  return { pathname: u.pathname, next: u.searchParams.get("next") };
}

const PROTECTED = [
  "/dashboard", "/loads", "/drivers", "/payroll", "/settlements", "/fleet",
  "/brokers", "/broker-contacts", "/expenses", "/documents", "/reports",
  "/settings", "/team",
];

const BYPASS_HEADERS: Record<string, string>[] = [
  { "x-middleware-subrequest": "middleware" },
  { "x-middleware-subrequest": "src/middleware" },
  { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
  { "x-middleware-prefetch": "1" },
  { "x-nextjs-data": "1" },
  { "next-router-prefetch": "1" },
  { rsc: "1" },
];

beforeEach(() => {
  auth.user = null;
  auth.refresh = false;
  auth.calls = 0;
  auth.seenCookies = [];
});

describe("signed out", () => {
  it.each(PROTECTED)("redirects %s (and its sub-paths) to sign-in with ?next", async (p) => {
    for (const path of [p, `${p}/x`, `${p}/x/y`]) {
      const res = await middleware(req(path));
      expect(res.status, path).toBeGreaterThanOrEqual(300);
      expect(res.status, path).toBeLessThan(400);
      expect(signinTarget(res), path).toEqual({ pathname: "/auth/signin", next: path });
    }
  });

  it.each(BYPASS_HEADERS)("ignores bypass header %o", async (headers) => {
    const res = await middleware(req("/dashboard", headers));
    expect(signinTarget(res)).toEqual({ pathname: "/auth/signin", next: "/dashboard" });
    expect(auth.calls).toBe(1);
  });

  it("does not gate look-alike prefixes", async () => {
    for (const path of ["/dashboards", "/loadsx", "/reportsfoo"]) {
      const res = await middleware(req(path));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("leaves public routes reachable", async () => {
    for (const path of ["/", "/auth/signin", "/auth/callback", "/join/ABC123"]) {
      const res = await middleware(req(path));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("keeps refreshed/cleared Supabase cookies on the redirect", async () => {
    auth.refresh = true;
    const res = await middleware(req("/loads"));
    expect(signinTarget(res)?.pathname).toBe("/auth/signin");
    expect(res.cookies.get("sb-test-auth-token.0")?.value).toBe("new-chunk-0");
    expect(res.cookies.get("sb-test-auth-token.1")?.value).toBe("new-chunk-1");
  });
});

describe("signed in", () => {
  beforeEach(() => { auth.user = { id: "user-1" }; });

  it.each(PROTECTED)("lets %s through", async (p) => {
    const res = await middleware(req(p));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("bounces /auth/signin to /dashboard and drops the query", async () => {
    const res = await middleware(req("/auth/signin?next=%2Floads"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/dashboard");
    expect(loc.search).toBe("");
  });

  it("propagates refreshed cookies on pass-through and on the sign-in bounce", async () => {
    auth.refresh = true;
    const pass = await middleware(req("/dashboard"));
    expect(pass.cookies.get("sb-test-auth-token.0")?.value).toBe("new-chunk-0");
    const bounce = await middleware(req("/auth/signin"));
    expect(bounce.cookies.get("sb-test-auth-token.0")?.value).toBe("new-chunk-0");
  });

  // Regression: the old per-cookie set() rebuilt the response on every call,
  // so only the LAST chunk of a refresh reached the browser (old .0 + new .1
  // → undecodable session → signed out ~1 h after login).
  it("keeps EVERY chunk of one refresh on the same response", async () => {
    auth.refresh = true;
    for (const path of ["/dashboard", "/auth/signin"]) {
      const res = await middleware(req(path, {
        cookie: "sb-test-auth-token.0=old-chunk-0; sb-test-auth-token.1=old-chunk-1",
      }));
      const setCookie = res.headers.getSetCookie().join("\n");
      expect(setCookie, path).toContain("sb-test-auth-token.0=new-chunk-0");
      expect(setCookie, path).toContain("sb-test-auth-token.1=new-chunk-1");
      expect(setCookie, path).not.toContain("old-chunk");
      expect(res.cookies.get("sb-test-auth-token")?.value, path).toBe("");
    }
  });

  it("forwards all refreshed chunks to downstream server components", async () => {
    auth.refresh = true;
    const res = await middleware(req("/dashboard", {
      cookie: "sb-test-auth-token.0=old-chunk-0; sb-test-auth-token.1=old-chunk-1",
    }));
    // NextResponse.next({ request }) re-sends the mutated request cookies
    // via the x-middleware-request-cookie override header.
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("sb-test-auth-token.0=new-chunk-0");
    expect(forwarded).toContain("sb-test-auth-token.1=new-chunk-1");
  });

  it("passes the request's session cookie to Supabase", async () => {
    await middleware(req("/dashboard", { cookie: "sb-test-auth-token=abc" }));
    expect(auth.seenCookies).toEqual(["abc"]);
  });
});

describe("matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it("runs on every app route", () => {
    for (const p of ["/", ...PROTECTED, "/loads/1/edit", "/reports/revenue/csv", "/join/X", "/auth/signin"]) {
      expect(re.test(p), p).toBe(true);
    }
  });
  it("skips only static assets", () => {
    for (const p of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/logo.png", "/a.svg"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});
