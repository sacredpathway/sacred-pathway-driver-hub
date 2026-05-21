// =============================================================================
//  sendInviteEmail — driver invite email delivery
// -----------------------------------------------------------------------------
//  Provider-agnostic helper that emails a driver invite link. Uses Resend
//  (https://resend.com) by default — single REST POST, free tier 100/day,
//  no SDK install required. If the env vars below are missing the helper
//  becomes a NO-OP that logs the would-be email and returns sent=false so
//  the calling server action can surface "Email NOT sent — copy this link
//  and message it to the driver" instead of failing the whole flow.
//
//  Required env vars (set in Cloudflare Pages → Project → Settings → Env
//  Variables for production, and in web-app/.env.local for dev):
//    RESEND_API_KEY        — your Resend API key (https://resend.com/api-keys)
//    RESEND_FROM_EMAIL     — verified sender, e.g. "Sacred Pathway <invites@app.sacredpathway.org>"
//                            Must use a domain you've verified in Resend.
//    NEXT_PUBLIC_APP_URL   — base for invite URLs, e.g. "https://app.sacredpathway.org"
//                            Falls back to https://app.sacredpathway.org if absent.
//
//  To swap providers later (SendGrid, Postmark, SMTP, Supabase SMTP, etc.):
//  replace the `dispatch()` function below — the public signature and the
//  return shape stay the same.
// =============================================================================

export interface SendInviteEmailInput {
  toEmail: string;
  toName?: string | null;
  carrierName: string;
  inviteCode: string;
  /** Pre-built URL like "https://app.sacredpathway.org/join/DRV-XXXX".
   *  Caller computes this so the helper doesn't fight over the base URL. */
  inviteUrl: string;
}

export interface SendInviteEmailResult {
  sent: boolean;
  /** Provider message id when sent; null when sent=false. */
  providerId: string | null;
  /** Human-readable reason. "ok" on success; configuration / provider error
   *  on failure. Surfaced to the carrier UI so they know whether to copy +
   *  paste the invite link manually as a fallback. */
  reason: string;
}

const APP_URL_FALLBACK = "https://app.sacredpathway.org";

export function getAppBaseUrl(): string {
  // Cloudflare Pages Edge runtime exposes env vars via process.env when the
  // Next.js adapter is built with nodejs_compat. Use a defensive fallback so
  // we never end up emailing a localhost link to a real driver.
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return APP_URL_FALLBACK;
  // Strip trailing slash so caller can always concatenate cleanly.
  return raw.replace(/\/$/, "");
}

export async function sendInviteEmail(
  input: SendInviteEmailInput
): Promise<SendInviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from   = process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    // Helpful console log so a dev can see exactly what would have been sent
    // even without configuring an email provider. Server-side only.
    console.warn(
      "[sendInviteEmail] RESEND_API_KEY or RESEND_FROM_EMAIL not set — " +
      "skipping email. Would have sent to " + input.toEmail +
      " with invite URL " + input.inviteUrl
    );
    return {
      sent: false,
      providerId: null,
      reason: "email_provider_not_configured",
    };
  }

  return dispatch(input, { apiKey, from });
}

// -----------------------------------------------------------------------------
// Provider dispatch — Resend REST API. Single POST, no SDK dep.
// -----------------------------------------------------------------------------

async function dispatch(
  input: SendInviteEmailInput,
  cfg: { apiKey: string; from: string }
): Promise<SendInviteEmailResult> {
  const subject = `${input.carrierName} invited you to Driver Hub`;
  const html = renderHtml(input);
  const text = renderText(input);

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to:   [input.toEmail],
        subject,
        html,
        text,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        sent: false,
        providerId: null,
        reason: `resend_${resp.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return {
      sent: true,
      providerId: data.id ?? null,
      reason: "ok",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return { sent: false, providerId: null, reason: `network: ${msg}` };
  }
}

// -----------------------------------------------------------------------------
// Email templates — minimal, branded, no images. Carrier name + CTA only.
// -----------------------------------------------------------------------------

function renderHtml(input: SendInviteEmailInput): string {
  const greeting = input.toName
    ? `Hi ${escapeHtml(input.toName)},`
    : "Hi,";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#1a1a1a;border-radius:14px;padding:32px;">
          <tr>
            <td>
              <h1 style="margin:0 0 12px 0;color:#D4AF37;font-size:24px;letter-spacing:-0.01em;">Driver Hub</h1>
              <p style="margin:0 0 18px 0;color:#9A9A9A;font-size:13px;">You've been invited to join a carrier</p>

              <p style="margin:0 0 14px 0;color:#f5f5f5;font-size:15px;line-height:1.55;">${greeting}</p>
              <p style="margin:0 0 14px 0;color:#f5f5f5;font-size:15px;line-height:1.55;">
                <strong>${escapeHtml(input.carrierName)}</strong> has invited you to join their carrier on Driver Hub.
                As a sponsored driver you'll get access to your pay history, expenses, and reports —
                <em>at no cost to you</em>, included with the carrier's subscription.
              </p>

              <p style="margin:18px 0 8px 0;color:#9A9A9A;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Your invite code</p>
              <p style="margin:0 0 18px 0;color:#D4AF37;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.04em;">${escapeHtml(input.inviteCode)}</p>

              <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px 0;">
                <tr>
                  <td align="center" style="background:#D4AF37;border-radius:10px;">
                    <a href="${escapeAttr(input.inviteUrl)}" style="display:inline-block;padding:14px 26px;color:#0A0A0A;text-decoration:none;font-weight:700;font-size:15px;">Accept invite</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;color:#9A9A9A;font-size:12px;line-height:1.6;">
                If the button doesn't work, copy this link into your browser:
              </p>
              <p style="margin:0 0 24px 0;color:#9A9A9A;font-size:12px;word-break:break-all;">
                <a href="${escapeAttr(input.inviteUrl)}" style="color:#D4AF37;">${escapeHtml(input.inviteUrl)}</a>
              </p>

              <p style="margin:0;color:#666;font-size:11px;line-height:1.6;">
                Didn't expect this email? You can safely ignore it — no account is created until you click the link and sign in.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0 0;color:#666;font-size:11px;">Sacred Pathway · Driver Hub</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderText(input: SendInviteEmailInput): string {
  const greeting = input.toName ? `Hi ${input.toName},` : "Hi,";
  return [
    "Driver Hub — You've been invited to join a carrier",
    "",
    greeting,
    "",
    `${input.carrierName} has invited you to join their carrier on Driver Hub.`,
    "As a sponsored driver you get access to your pay history, expenses, and",
    "reports — at no cost to you, included with the carrier's subscription.",
    "",
    `Invite code: ${input.inviteCode}`,
    `Accept here: ${input.inviteUrl}`,
    "",
    "Didn't expect this? You can safely ignore — no account is created",
    "until you click the link and sign in.",
    "",
    "Sacred Pathway · Driver Hub",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// HTML escaping — no DOMPurify, no template engine, just guard the 5 chars
// that matter.
// -----------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
