// Local stand-in for https://<staging>.supabase.co used ONLY for the browser test.
// Everything is forwarded to the synthetic staging project unchanged, EXCEPT
// POST /functions/v1/extract-document (Edge Function v22 is not deployed on
// staging): it is answered here exactly like v22 does for v3 — read the
// caller's own document (their JWT, RLS), download the stored file, "read" it
// (synthetic fixtures keyed by the marker printed on each test PDF), run the
// real v3 sanitizer, and write the document row as that user.
import http from "node:http";
import https from "node:https";
import { sanitizePayrollExtraction } from "../../../../web-app/lib/documents/payrollExtraction";

const UPSTREAM = "aatkirzwuuegurdlmcpl.supabase.co";
const ANON = process.env.ANON!;
const ev = (v: unknown, t: string) => ({ value: v, page: 1, source_text: t, confidence: "high" });
const RC = (n: string, total: number, extra: Record<string, unknown>) => ({
  document_type: "rate_confirmation", confidence: "high", page_count: 1, notes: "",
  fields: {
    load_number: ev(n, `Load # ${n}`), broker_name: ev("Blue Ridge Logistics", "Blue Ridge Logistics"), broker_mc_number: ev("500100", "MC# 500100"),
    carrier_name: ev("AP Synthetic Freight LLC", "Carrier: AP Synthetic Freight LLC"), carrier_mc_number: ev("MC771234", "MC# 771234"),
    line_haul_rate: ev(total, `Line Haul: $${total.toFixed(2)}`), fuel_surcharge: ev(0, "Fuel Surcharge: $0.00"), accessorial_charges: ev(0, "$0.00"),
    total_revenue: ev(total, `Total Carrier Pay: $${total.toFixed(2)}`), ...extra,
  },
});
const POD = (n: string, extra: Record<string, unknown>) => ({
  document_type: "pod", confidence: "high", page_count: 1, notes: "",
  fields: { load_number: ev(n, `Load # ${n}`), bol_number: ev(`BOL-${n}`, `BOL # BOL-${n}`), signature_present: ev(true, "signed"), ...extra },
});
const RCPT = (type: string, vendor: string, amount: number, n: string, date: string) => ({
  document_type: type, confidence: "high", page_count: 1, notes: "",
  fields: { vendor_name: ev(vendor, vendor), expense_amount: ev(amount, `TOTAL $${amount.toFixed(2)}`), receipt_date: ev(date, date), load_number: ev(n, `Load ${n}`) },
});
const d1 = { pickup_date: ev("2026-10-13", "10/13/2026"), delivery_date: ev("2026-10-14", "10/14/2026"), origin: ev("Dallas, TX", "Dallas, TX"), destination: ev("Houston, TX", "Houston, TX") };
const d2 = { pickup_date: ev("2026-10-14", "10/14/2026"), delivery_date: ev("2026-10-15", "10/15/2026"), origin: ev("Tulsa, OK", "Tulsa, OK"), destination: ev("Denver, CO", "Denver, CO") };
const MODEL: Record<string, unknown> = {
  "rc-apb-1001": RC("APB-1001", 1850, { ...d1, total_miles: ev(240, "Miles: 240"), driver_name: ev("Marcus Reed", "Driver: Marcus Reed") }),
  "pod-apb-1001": POD("APB-1001", d1),
  "fuel-apb-1001": RCPT("fuel_receipt", "Pilot Travel Center #452", 412.18, "APB-1001", "2026-10-14"),
  "pod-apb-2002": POD("APB-2002", d2),
  "fuel-apb-2002": RCPT("fuel_receipt", "Loves Travel Stop #611", 398.4, "APB-2002", "2026-10-14"),
  "toll-apb-2002": RCPT("toll", "Kansas Turnpike Authority", 18.25, "APB-2002", "2026-10-14"),
  "rc-apb-2002": RC("APB-2002", 2400, { ...d2, total_miles: ev(680, "Miles: 680"), driver_name: ev("Tina Alvarez", "Driver: Tina Alvarez") }),
};

function upstream(method: string, path: string, headers: Record<string, string>, body?: Buffer): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: UPSTREAM, path, method, headers: { ...headers, host: UPSTREAM } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function extract(auth: string, body: Record<string, unknown>) {
  const h = { apikey: ANON, authorization: auth, "content-type": "application/json" };
  const id = String(body.document_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { success: false, code: "BAD_REQUEST" };
  const doc = await upstream("GET", `/rest/v1/documents?id=eq.${id}&select=id,profile_id,storage_path,status`, h);
  const row = (JSON.parse(doc.body.toString() || "[]") as Array<{ storage_path: string }>)[0];
  if (!row) return { success: false, code: "AUTH_EXPIRED", message: "not your document" };
  const file = await upstream("GET", `/storage/v1/object/authenticated/documents/${row.storage_path}`, { apikey: ANON, authorization: auth });
  if (file.status !== 200) return { success: false, code: "STORAGE_ERROR", message: `download ${file.status}` };
  const key = /KEY:([a-z0-9-]+)/.exec(file.body.toString("latin1"))?.[1] ?? "";
  const raw = MODEL[key];
  if (!raw) return { success: false, code: "UNKNOWN_SCAN_ERROR", message: "unreadable" };
  if (body.extraction_version !== "v3") return { success: false, code: "BAD_VERSION" };
  const s = sanitizePayrollExtraction(raw);
  const extracted = { ...s, parse_stage: "strict", type_hint: body.type_hint ?? null };
  const upd = await upstream("PATCH", `/rest/v1/documents?id=eq.${id}`, { ...h, prefer: "return=minimal" }, Buffer.from(JSON.stringify({
    status: "processed", processed: true, extracted_data: extracted, confidence: extracted.model_confidence ?? "low",
    document_type: s.stored_document_type, provider: "synthetic-test", model: "fixture", extraction_version: "v3", error_message: null,
  })));
  if (upd.status >= 300) return { success: false, code: "UNKNOWN_SCAN_ERROR", message: `update ${upd.status} ${upd.body.toString().slice(0, 200)}` };
  console.log(`[extract] ${key} -> ${s.document_type}`);
  return { success: true, document_id: id, status: "processed", extraction_version: "v3" };
}

http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const cors = { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-upsert", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-allow-credentials": "true" };
    if (req.url?.startsWith("/functions/v1/extract-document")) {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      const out = await extract(String(req.headers.authorization ?? ""), JSON.parse(body.toString() || "{}")).catch((e) => ({ success: false, code: "ERR", message: String(e) }));
      res.writeHead(out.success ? 200 : 400, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify(out));
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "host" && k !== "connection" && k !== "accept-encoding") headers[k] = v;
    const pr = https.request({ host: UPSTREAM, path: req.url, method: req.method, headers: { ...headers, host: UPSTREAM } }, (up) => {
      const h = { ...up.headers };
      delete h["content-encoding"]; delete h["transfer-encoding"];
      res.writeHead(up.statusCode ?? 502, h);
      up.pipe(res);
    });
    pr.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    if (body.length) pr.write(body);
    pr.end();
  });
}).listen(54321, "127.0.0.1", () => console.log("proxy on 127.0.0.1:54321 -> " + UPSTREAM));
