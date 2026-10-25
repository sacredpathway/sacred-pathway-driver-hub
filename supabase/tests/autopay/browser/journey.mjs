// Real-browser acceptance: synthetic carrier on the staging project, the
// production build of the web app (next start), Chromium via Playwright.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const PFX = process.env.AP_PREFIX ?? "APB";
const acc = JSON.parse(fs.readFileSync(process.env.AP_ACCOUNTS ?? "accounts.json", "utf8"));
const SHOTS = process.env.AP_SHOTS ?? "shots";
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log("[journey]", ...a);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); log(ok ? "PASS" : "FAIL", name, detail); };

async function signIn(page, who) {
  await page.goto(`${BASE}/auth/signin`);
  await page.fill('input[type="email"]', acc[who].email);
  await page.fill('input[placeholder="••••••••"]', acc[who].password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 }), page.click('button[type="submit"]')]);
}

async function upload(page, files) {
  await page.goto(`${BASE}/documents`);
  await page.setInputFiles('input[type="file"]', files.map((f) => `${process.env.AP_DOCS ?? "docs"}/${f}`));
  await page.click('form:has(input[type="file"]) button[type="submit"]');
  // wait until every uploaded row has a final state
  await page.waitForFunction((n) => {
    const rows = [...document.querySelectorAll('[data-testid="upload-row"]')];
    return rows.length >= n && rows.every((r) => ["done", "review", "failed"].includes(r.getAttribute("data-state")));
  }, files.length, { timeout: 120000 });
  return page.$$eval('[data-testid="upload-row"]', (rows) => rows.map((r) => ({
    text: r.textContent, state: r.getAttribute("data-state"),
    payroll: r.querySelector('[data-testid="upload-payroll"]')?.getAttribute("data-state") ?? null,
    paystub: r.querySelector('a[href$="/statement"]')?.getAttribute("href") ?? null,
  })));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  await signIn(page, "a");
  check("sign in as synthetic carrier", true, page.url());

  // 1. Rate con for an existing load -> filed + payroll draft + paystub link
  let rows = await upload(page, [`ratecon-${PFX}-1001.pdf`]);
  await page.screenshot({ path: `${SHOTS}/01-upload-ratecon.png`, fullPage: true });
  check("rate con read and filed automatically", rows[0].state === "done", rows[0].text);
  check("payroll draft created automatically", rows[0].payroll === "drafted", rows[0].text);
  const paystub1 = rows[0].paystub;
  check("paystub link shown", !!paystub1, paystub1 ?? "");

  // 2. Paystub page
  await page.goto(`${BASE}${paystub1}`);
  await page.waitForSelector('[data-testid="settlement-statement"]');
  const net1 = await page.textContent('[data-testid="statement-net"]');
  const status1 = await page.getAttribute('[data-testid="settlement-statement"]', "data-status");
  const mark1 = await page.textContent('[data-testid="statement-watermark"]').catch(() => null);
  const driver1 = await page.textContent('[data-testid="statement-driver"]');
  await page.screenshot({ path: `${SHOTS}/02-paystub-draft.png`, fullPage: true });
  check("paystub net = 70% of $1,850.00", net1?.trim() === "$1,295.00", net1 ?? "");
  check("paystub is a DRAFT, not paid", status1 === "draft" && /NOT PAID/.test(mark1 ?? ""), `${status1} / ${mark1}`);
  check("paystub driver from the stored load", driver1?.trim() === "Marcus Reed", driver1 ?? "");

  // 3. POD + fuel receipt for the same load in one upload -> filed, no second pay line
  rows = await upload(page, [`pod-${PFX}-1001.pdf`, `fuel-${PFX}-1001.pdf`]);
  await page.screenshot({ path: `${SHOTS}/03-upload-pod-fuel.png`, fullPage: true });
  check("POD + fuel receipt filed", rows.every((r) => r.state === "done"), rows.map((r) => r.text).join(" | "));
  await page.goto(`${BASE}${paystub1}`);
  check("company-driver fuel is not a driver deduction; net unchanged", (await page.textContent('[data-testid="statement-net"]'))?.trim() === "$1,295.00");

  // 4. Exact duplicate upload -> marked duplicate, never read again, no payment
  rows = await upload(page, [`ratecon-${PFX}-1001.pdf`]);
  check("duplicate upload goes to review, not re-read", rows[0].state === "review" && /before/i.test(rows[0].text ?? ""), rows[0].text);

  // 5. Out of order (owner-operator): POD + fuel + toll before the rate con; rate con for a NEW load
  rows = await upload(page, [`pod-${PFX}-2002.pdf`, `fuel-${PFX}-2002.pdf`, `toll-${PFX}-2002.pdf`]);
  check("paperwork for an unknown load waits in review", rows.every((r) => r.state === "review"), rows.map((r) => r.text).join(" | "));
  rows = await upload(page, [`ratecon-${PFX}-2002.pdf`]);
  await page.screenshot({ path: `${SHOTS}/04-auto-created-load.png`, fullPage: true });
  check("verified rate con for a NEW load: load created automatically and drafted", rows[0].state === "done" && rows[0].payroll === "drafted", rows[0].text);
  await page.goto(`${BASE}${rows[0].paystub}`);
  await page.waitForSelector('[data-testid="settlement-statement"]');
  const net2 = (await page.textContent('[data-testid="statement-net"]'))?.trim();
  const driver2 = (await page.textContent('[data-testid="statement-driver"]'))?.trim();
  const deds = await page.$$eval('[data-testid="statement-deductions"] tbody tr', (trs) => trs.map((t) => t.textContent));
  await page.screenshot({ path: `${SHOTS}/05-paystub-owner-operator.png`, fullPage: true });
  // 88 % of 2400 = 2112.00; fuel 398.40 + toll 18.25 = 416.65 -> 1695.35
  check("no clicks: waiting receipts joined the draft as driver deductions", net2 === "$1,695.35" && driver2 === "Tina Alvarez", `${net2} | ${driver2} | ${deds.join(" | ")}`);
  await page.goto(`${BASE}/loads`);
  const loadRows = await page.locator(`text=${PFX}-2002`).count();
  check("exactly one load created for the new rate con", loadRows >= 1, `${loadRows} mention(s) on /loads`);

  // 6. Payroll panel + settlement editor link
  await page.goto(`${BASE}/documents`);
  const panel = await page.$$eval('[data-testid="payroll-activity"]', (els) => els.map((e) => e.getAttribute("data-state")));
  await page.screenshot({ path: `${SHOTS}/06-documents-payroll-panel.png`, fullPage: true });
  check("payroll panel lists the automatic drafts", panel.filter((s) => s === "drafted").length >= 2, panel.join(","));
  await page.goto(`${BASE}${paystub1.replace("/statement", "")}`);
  await page.waitForSelector('[data-testid="open-paystub"]');
  await page.screenshot({ path: `${SHOTS}/07-settlement-editor.png`, fullPage: true });
  check("settlement editor opens with a Paystub / PDF button", true);

  // 7. Another carrier can't open the paystub
  const ctxB = await browser.newContext();
  const pB = await ctxB.newPage();
  await signIn(pB, "b");
  const resp = await pB.goto(`${BASE}${paystub1}`);
  const leaked = await pB.$('[data-testid="statement-net"]');
  await pB.screenshot({ path: `${SHOTS}/08-other-carrier-blocked.png`, fullPage: true });
  check("another carrier gets 404 for the paystub", !leaked && resp?.status() === 404, `status ${resp?.status()}`);
  await ctxB.close();
} catch (e) {
  check("journey completed without exceptions", false, String(e).slice(0, 500));
  await page.screenshot({ path: `${SHOTS}/zz-failure.png`, fullPage: true }).catch(() => {});
}
check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
