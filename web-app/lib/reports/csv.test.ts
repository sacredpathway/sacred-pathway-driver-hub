import { describe, expect, it } from "vitest";
import { buildCsv, csvResponse } from "./csv";

describe("buildCsv (RFC 4180)", () => {
  const cols = [
    { header: "Name", get: (r: { name: string | null }) => r.name },
    { header: "Amount", get: (r: { amount?: number }) => r.amount },
  ] as const;

  it("emits header + CRLF rows with a trailing CRLF", () => {
    const csv = buildCsv([{ name: "A", amount: 1.5 }], cols as never);
    expect(csv).toBe("Name,Amount\r\nA,1.5\r\n");
  });

  it("quotes commas, quotes and newlines; blanks null/NaN", () => {
    const csv = buildCsv(
      [{ name: 'Acme, "Inc"\nEast', amount: Number.NaN }, { name: null }],
      cols as never,
    );
    expect(csv).toBe('Name,Amount\r\n"Acme, ""Inc""\nEast",\r\n,\r\n');
  });

  it("csvResponse adds BOM and download headers", async () => {
    const res = csvResponse("x.csv", "a\r\n");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="x.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("a\r\n");
  });
});
