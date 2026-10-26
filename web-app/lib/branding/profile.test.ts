import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BRANDING_BUCKET,
  logoStoragePath,
  profileToBranding,
  signLogoUrl,
} from "./profile";

describe("profileToBranding", () => {
  it("maps a full profiles row", () => {
    expect(
      profileToBranding({
        company_name: "  Sacred Pathway LLC ",
        logo_storage_path: "abc/logo.png",
        paystub_theme: "forest_gold",
        paystub_footer_legal: "  Paid via ACH. ",
      }),
    ).toEqual({
      companyName: "Sacred Pathway LLC",
      logoPath: "abc/logo.png",
      paystubTheme: "forest_gold",
      footerLegal: "Paid via ACH.",
    });
  });

  it("null / empty / partial rows fall back safely", () => {
    const empty = { companyName: null, logoPath: null, paystubTheme: "navy_gold", footerLegal: "" };
    expect(profileToBranding(null)).toEqual(empty);
    expect(profileToBranding(undefined)).toEqual(empty);
    expect(profileToBranding({ company_name: "   ", logo_storage_path: "" })).toEqual(empty);
  });

  it("an unknown theme falls back to navy_gold", () => {
    expect(profileToBranding({ paystub_theme: "hot_pink" }).paystubTheme).toBe("navy_gold");
  });
});

describe("logoStoragePath", () => {
  it("lowercases the profile id (storage RLS compares to auth.uid()::text)", () => {
    expect(logoStoragePath("ABCDEF-1234", "png")).toBe("abcdef-1234/logo.png");
  });
});

describe("signLogoUrl", () => {
  function fakeClient(result: unknown, spy = vi.fn()) {
    return {
      client: {
        storage: {
          from: (bucket: string) => {
            spy(bucket);
            return { createSignedUrl: async () => result };
          },
        },
      } as unknown as SupabaseClient,
      spy,
    };
  }

  it("signs from the branding STORAGE bucket", async () => {
    const { client, spy } = fakeClient({ data: { signedUrl: "https://x/y" }, error: null });
    await expect(signLogoUrl(client, "abc/logo.png")).resolves.toBe("https://x/y");
    expect(spy).toHaveBeenCalledWith(BRANDING_BUCKET);
  });

  it("returns null with no path, on RLS denial, or on throw", async () => {
    const { client, spy } = fakeClient({ data: null, error: { message: "denied" } });
    await expect(signLogoUrl(client, null)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await expect(signLogoUrl(client, "abc/logo.png")).resolves.toBeNull();
    const throwing = {
      storage: { from: () => ({ createSignedUrl: async () => { throw new Error("net"); } }) },
    } as unknown as SupabaseClient;
    await expect(signLogoUrl(throwing, "abc/logo.png")).resolves.toBeNull();
  });
});
