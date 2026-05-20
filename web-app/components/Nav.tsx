// Top nav for the authenticated app shell. Mobile-first: collapses to a
// hamburger drawer below the `md` breakpoint.
//
// Phase W4 — accepts optional companyName + logoUrl. When the carrier has
// uploaded a logo on /settings, that image renders in place of the gold
// "DH" tile. When they've set a company name, it replaces the static
// "Driver Hub" wordmark. Either / both may be null on a fresh account; the
// header falls back cleanly.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/dashboard",        label: "Dashboard"       },
  { href: "/loads",            label: "Loads"           },
  { href: "/drivers",          label: "Drivers"         },
  { href: "/payroll",          label: "Payroll"         },
  { href: "/fleet",            label: "Fleet"           },
  { href: "/brokers",          label: "Brokers"         },
  { href: "/broker-contacts",  label: "Broker Contacts" },
  { href: "/expenses",         label: "Expenses"        },
  { href: "/documents",        label: "Documents"       },
  { href: "/settings",         label: "Settings"        },
];

export default function Nav({
  email,
  companyName,
  logoUrl,
}: {
  email?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const displayName = companyName?.trim() ? companyName : "Driver Hub";

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-sp-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={companyName ? `${companyName} logo` : "Company logo"}
              className="h-8 w-8 rounded-md object-contain"
            />
          ) : (
            <span className="rounded-md bg-sp-gold px-2 py-1 text-xs font-bold text-sp-black">
              DH
            </span>
          )}
          <span className="truncate font-semibold tracking-tight text-sp-textPrimary">
            {displayName}
          </span>
        </Link>

        <nav className="hidden gap-1 md:flex">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "rounded-md px-3 py-2 text-sm transition " +
                  (active
                    ? "bg-sp-gold/15 text-sp-gold"
                    : "text-sp-textSecondary hover:text-sp-textPrimary")
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {email && (
            <span className="hidden text-xs text-sp-textSecondary md:inline">
              {email}
            </span>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="hidden rounded-md border border-white/10 px-3 py-1.5 text-xs text-sp-textPrimary hover:bg-white/5 md:inline"
            >
              Sign out
            </button>
          </form>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="rounded-md p-2 text-sp-textPrimary hover:bg-white/5 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d={open ? "M6 6 L18 18 M18 6 L6 18" : "M4 7h16 M4 12h16 M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-white/5 bg-sp-background md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={
                    "rounded-md px-3 py-2 text-sm transition " +
                    (active
                      ? "bg-sp-gold/15 text-sp-gold"
                      : "text-sp-textPrimary hover:bg-white/5")
                  }
                >
                  {l.label}
                </Link>
              );
            })}
            {email && (
              <span className="px-3 pt-2 text-xs text-sp-textSecondary">{email}</span>
            )}
            <form action="/auth/signout" method="post" className="px-3 pt-1">
              <button
                type="submit"
                className="w-full rounded-md border border-white/10 px-3 py-2 text-sm text-sp-textPrimary hover:bg-white/5"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      )}
    </header>
  );
}
