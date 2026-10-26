// =============================================================================
//  Extraction versions the web pipeline understands
// -----------------------------------------------------------------------------
//    v2  generic document extraction (Edge Function v21, deployed)
//    v3  payroll profile: every v2 field PLUS per-field evidence, driver /
//        equipment on rate cons and BOLs, and statement fields (Edge Function
//        v22, NOT deployed yet). Routing reads v3 through toV2Compatible(),
//        so ONE model call serves filing AND payroll.
//
//  The website asks for v3 only when DOCUMENT_EXTRACTION_VERSION=v3 is set.
//  Never set it before Edge Function v22 is live: the deployed v21 does not
//  know "v3" and would treat the request as the iPhone's v1 contract.
// =============================================================================

export const ROUTABLE_EXTRACTION_VERSIONS = ["v2", "v3"] as const;
export type RoutableExtractionVersion = (typeof ROUTABLE_EXTRACTION_VERSIONS)[number];

export function isRoutableVersion(v: unknown): v is RoutableExtractionVersion {
  return v === "v2" || v === "v3";
}

/** Version the website requests from extract-document. Default v2. */
export function webExtractionVersion(env: Readonly<Record<string, string | undefined>>): RoutableExtractionVersion {
  return (env.DOCUMENT_EXTRACTION_VERSION ?? "").trim().toLowerCase() === "v3" ? "v3" : "v2";
}
