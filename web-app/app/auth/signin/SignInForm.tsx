"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Three auth modes, all backed by Supabase:
//   • password   — primary. Same email+password the iOS app accepts.
//   • magiclink  — fallback. Sends a one-tap link to the inbox.
//                  Subject to Supabase free-tier rate limits (~4/hr).
//   • reset      — request a password-reset email. Same Supabase
//                  endpoint as the iOS app's "Forgot password" flow.
type Mode = "password" | "magiclink" | "reset";

export default function SignInForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function origin(): string {
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const trimmed = email.trim().toLowerCase();

      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (error) throw error;
        // Session cookie is now set; let the server re-render the route.
        router.refresh();
        router.push(nextPath);
        return;
      }

      if (mode === "magiclink") {
        const redirectTo = `${origin()}/auth/callback?next=${encodeURIComponent(nextPath)}`;
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
        });
        if (error) throw error;
        setInfo("Check your email — sign-in link sent. Link expires in 1 hour.");
        return;
      }

      // mode === "reset"
      const redirectTo = `${origin()}/auth/callback?next=${encodeURIComponent("/dashboard")}`;
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (error) throw error;
      setInfo("Password reset link sent. Open it from your email to set a new password.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel =
    mode === "password" ? "Sign In"
    : mode === "magiclink" ? "Email me a sign-in link"
    : "Email me a password-reset link";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
          Email
        </span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@trucking.co"
          disabled={busy}
          className="w-full rounded-lg bg-sp-cardLight px-4 py-3 text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
        />
      </label>

      {mode === "password" && (
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-sp-textSecondary">
            Password
          </span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={busy}
              className="w-full rounded-lg bg-sp-cardLight px-4 py-3 pr-16 text-sp-textPrimary placeholder:text-sp-textSecondary outline-none ring-1 ring-white/5 focus:ring-sp-gold"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-sp-gold hover:bg-white/5"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>
      )}

      <button
        type="submit"
        disabled={
          busy ||
          email.length === 0 ||
          (mode === "password" && password.length === 0)
        }
        className="w-full rounded-lg bg-sp-gold px-4 py-3 font-semibold text-sp-black transition disabled:opacity-50 hover:brightness-110"
      >
        {busy ? "Working…" : primaryLabel}
      </button>

      {/* Mode switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        {mode !== "password" && (
          <button
            type="button"
            onClick={() => { setMode("password"); setErr(null); setInfo(null); }}
            className="font-medium text-sp-gold hover:underline"
          >
            ← Use password
          </button>
        )}
        {mode !== "magiclink" && (
          <button
            type="button"
            onClick={() => { setMode("magiclink"); setErr(null); setInfo(null); }}
            className="font-medium text-sp-textSecondary hover:text-sp-textPrimary hover:underline"
          >
            Email me a sign-in link
          </button>
        )}
        {mode !== "reset" && (
          <button
            type="button"
            onClick={() => { setMode("reset"); setErr(null); setInfo(null); }}
            className="font-medium text-sp-textSecondary hover:text-sp-textPrimary hover:underline"
          >
            Forgot password?
          </button>
        )}
      </div>

      {info && (
        <p className="rounded-lg bg-sp-success/10 px-3 py-2 text-sm text-sp-success">
          {info}
        </p>
      )}
      {err && (
        <p className="rounded-lg bg-sp-danger/10 px-3 py-2 text-sm text-sp-danger">
          {err}
        </p>
      )}

      <p className="pt-2 text-center text-xs text-sp-textSecondary">
        Need an account? Sign up on the{" "}
        <Link
          href="https://apps.apple.com/app/sacred-pathway-driver-hub/id0000000000"
          className="text-sp-gold hover:underline"
        >
          iPhone app
        </Link>
        , then sign in here with the same email.
      </p>
    </form>
  );
}
