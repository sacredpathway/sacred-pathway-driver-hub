// =============================================================================
//  Smart Payroll Upload — file type sniffing and HEIC handling plan (pure)
// -----------------------------------------------------------------------------
//  The v2/v3 extractor does not accept HEIC. The ORIGINAL upload is always
//  kept byte-for-byte (its SHA-256 is the duplicate fingerprint); a derived
//  JPEG is produced on the client only as the extraction input.
//
//  The converter is injected:
//    * iPhone (future 2.3.8): UIImage(data:) -> jpegData(compressionQuality:)
//    * web (future): a browser HEIC decoder, behind the same interface
//  Nothing here converts by itself, so no new dependency is added now.
// =============================================================================

export type SniffedType = "pdf" | "jpeg" | "png" | "heic" | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export function sniffFileType(bytes: Uint8Array): SniffedType {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12) {
    const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (box === "ftyp" && HEIC_BRANDS.has(brand)) return "heic";
  }
  return "unknown";
}

const MIME_OF: Record<Exclude<SniffedType, "unknown">, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
};

const DECLARED: Record<string, SniffedType> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // = documents bucket limit
export const MIN_UPLOAD_BYTES = 1024;

export type UploadPlan =
  | {
      ok: true;
      original: { mime: string; keep: true };
      extractionInput: { convert: false; mime: string } | { convert: true; from: "image/heic"; to: "image/jpeg" };
      declaredMismatch: boolean;
    }
  | { ok: false; reason: "too_large" | "too_small" | "unsupported_type" };

/** Decides from the BYTES (not the file name) what to store and what to extract. */
export function planUpload(declaredMime: string | null, bytes: Uint8Array): UploadPlan {
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.length < MIN_UPLOAD_BYTES) return { ok: false, reason: "too_small" };
  const t = sniffFileType(bytes);
  if (t === "unknown") return { ok: false, reason: "unsupported_type" };
  const declared = declaredMime ? DECLARED[declaredMime.toLowerCase()] : undefined;
  return {
    ok: true,
    original: { mime: MIME_OF[t], keep: true },
    extractionInput: t === "heic" ? { convert: true, from: "image/heic", to: "image/jpeg" } : { convert: false, mime: MIME_OF[t] },
    declaredMismatch: declared !== undefined && declared !== t,
  };
}

export interface HeicConverter {
  /** Returns JPEG bytes for the given HEIC bytes. */
  toJpeg(heic: Uint8Array): Promise<Uint8Array>;
}

export type ConversionResult =
  | { ok: true; jpeg: Uint8Array }
  | { ok: false; reason: "not_heic" | "converter_failed" | "output_not_jpeg"; detail?: string };

/** Runs an injected converter and verifies the output really is a JPEG. */
export async function convertForExtraction(heic: Uint8Array, converter: HeicConverter): Promise<ConversionResult> {
  if (sniffFileType(heic) !== "heic") return { ok: false, reason: "not_heic" };
  let out: Uint8Array;
  try {
    out = await converter.toJpeg(heic);
  } catch (e) {
    return { ok: false, reason: "converter_failed", detail: String((e as Error)?.message ?? e).slice(0, 200) };
  }
  if (sniffFileType(out) !== "jpeg") return { ok: false, reason: "output_not_jpeg" };
  return { ok: true, jpeg: out };
}
