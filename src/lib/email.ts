/**
 * Sending an email – the notifications' second channel.
 *
 * ── Off until it is configured, and said to be ────────────────────────────────────────────
 *
 * Through Resend's HTTP API, with no SDK: one POST. It needs two settings – `RESEND_API_KEY`, and
 * `EMAIL_FROM`, an address on a domain verified with Resend ("Mzilikazi QS <alerts@mziprop.co.za>").
 * Without both nothing is sent and every notification records why, so "the email never came" is
 * answered by the platform rather than by guessing. The bell works either way.
 */

import { EgressRefused, guard } from "@/lib/egress/gateway";
import { outbound } from "@/lib/egress/transport";

export const emailConfigured =(): boolean => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export type EmailOutcome = { sent: true } | { sent: false; reason: string };

/**
 * Send one email, through the outbound gateway (ARC-005, email.notify).
 *
 * The recipient's address is the envelope and is not scanned. The subject and body are: anything in
 * them that names a person or a company, or is more sensitive, is removed before the provider sees
 * it, and the body always carries the link back, so the reader opens the detail in the platform
 * rather than in their inbox. A refusal (no recorded basis for the provider) is returned as a reason,
 * like every other failure here, so the notification records why no email went.
 */
export async function sendEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }): Promise<EmailOutcome> {
  if (!emailConfigured()) return { sent: false, reason: "Email is not configured on this deployment (RESEND_API_KEY and EMAIL_FROM)." };

  /*
    Subject, text and HTML are guarded as one piece so a name is removed from all three alike. The
    separator is a line no detector can match across, and the three parts are split back out after.
  */
  const SEPARATOR = "\n⁣⁣⁣\n";
  let guarded: { subject: string; text: string; html: string };
  try {
    const sent = await guard({ purpose: "email.notify", vendor: "resend", text: [subject, text, html].join(SEPARATOR) });
    const [s, t, h] = sent.text.split(SEPARATOR);
    if (s === undefined || t === undefined || h === undefined) throw new EgressRefused("The email could not be prepared, so it was not sent.", "separator lost in transform");
    guarded = { subject: s, text: t, html: h };
  } catch (error) {
    if (error instanceof EgressRefused) return { sent: false, reason: error.message };
    throw error;
  }

  try {
    const response = await outbound("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], ...guarded }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // The provider's own words – an unverified domain and a bad key send a person to different places.
      const detail = await response
        .json()
        .then((b) => (b as { message?: string }).message)
        .catch(() => null);
      return { sent: false, reason: `The email service refused it (HTTP ${response.status})${detail ? `: ${detail}` : "."}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: `The email service could not be reached: ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

/** Where a link in an email points: the production address where there is one. */
export function absoluteUrl(path: string): string {
  const base = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain, readable email – the notification, a link to it, and how to stop them. */
export function notificationEmail({ title, body, href, project }: { title: string; body: string | null; href: string | null; project: string | null }) {
  const link = href ? absoluteUrl(href) : absoluteUrl("/");
  const text = [project ? `${project}\n` : "", title, body ? `\n${body}` : "", `\n\nOpen it: ${link}`, "\n\n—\nMzilikazi QS Platform. Turn these emails off from the bell in the platform."].join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1a1f26">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d8dce3;border-radius:10px;padding:24px">
${project ? `<p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#5a6371">${escape(project)}</p>` : ""}
<p style="margin:0 0 10px;font-size:17px;font-weight:600">${escape(title)}</p>
${body ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#282e37">${escape(body)}</p>` : ""}
<a href="${escape(link)}" style="display:inline-block;background:#4a7722;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:9px 16px;border-radius:6px">Open in the platform</a>
<p style="margin:22px 0 0;font-size:12px;color:#5a6371">Mzilikazi QS Platform · Turn these emails off from the bell in the platform.</p>
</div></body></html>`;
  return { subject: project ? `${title} – ${project}` : title, text, html };
}
