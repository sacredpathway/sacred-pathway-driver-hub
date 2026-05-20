// =============================================================================
//  LogoCard — Carrier HQ Phase W4
// -----------------------------------------------------------------------------
//  Logo preview + upload + remove. Two separate <form>s:
//    • upload  — calls uploadLogoAction via useActionState (inline error UI)
//    • remove  — direct form action, lighter weight
//
//  Object key is always "<profile_id>/logo.<ext>", upserted by the server
//  action. The signed URL is generated in the parent server component.
// =============================================================================

"use client";

import { useActionState } from "react";
import { uploadLogoAction, deleteLogoAction, type SettingsActionState } from "./actions";

export default function LogoCard({
  logoUrl,
  hasLogo,
}: {
  logoUrl: string | null;
  hasLogo: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    SettingsActionState | undefined,
    FormData
  >(uploadLogoAction, undefined);

  return (
    <section className="rounded-xl border border-white/5 bg-sp-card p-5">
      <header className="mb-3 space-y-1">
        <h2 className="text-base font-semibold text-sp-textPrimary">Company logo</h2>
        <p className="text-xs text-sp-textSecondary">
          PNG, JPG, WebP, or SVG. Up to 5&nbsp;MB. Shown in the app header and
          on every paystub PDF.
        </p>
      </header>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-sp-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Company logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-sp-textSecondary">
              No logo
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          {state && !state.ok && (
            <div className="rounded-md border border-sp-danger/40 bg-sp-danger/10 px-3 py-2 text-xs text-sp-danger">
              {state.error}
            </div>
          )}
          {state && state.ok && (
            <div className="rounded-md border border-sp-success/40 bg-sp-success/10 px-3 py-2 text-xs text-sp-success">
              Logo uploaded.
            </div>
          )}

          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-white/10 bg-sp-cardLight px-4 py-2 text-sm font-medium text-sp-textPrimary hover:bg-white/5">
              <span>{hasLogo ? "Replace logo" : "Upload logo"}</span>
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  // Auto-submit when the user picks a file — saves a click.
                  if (e.currentTarget.files?.length) {
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </label>
            {pending && (
              <span className="text-xs text-sp-textSecondary">Uploading…</span>
            )}
          </form>

          {hasLogo && (
            <form action={deleteLogoAction}>
              <button
                type="submit"
                className="self-start text-xs font-medium text-sp-danger hover:underline"
              >
                Remove logo
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
