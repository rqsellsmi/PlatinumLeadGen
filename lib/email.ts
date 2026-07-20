/**
 * Email — Microsoft Graph API (Spec Section 6).
 *
 * Token reliability fix (Section 6.3): the OAuth access token is persisted to
 * Neon (ms_graph_tokens, single row) so every Vercel serverless invocation
 * shares it instead of re-fetching from in-memory cache (which is lost between
 * invocations). Every send is recorded in email_send_log (Section 6.4).
 *
 * Uses the OAuth 2.0 client-credentials flow — no user sign-in, no refresh
 * token. Re-authenticate with client credentials when the access token expires.
 *
 * SMS (agent texting) is a separate integration — see lib/sms.ts (Telnyx).
 */
import { siteUrl } from './siteUrl';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { msGraphTokens, emailSendLog } from '../drizzle/schema';

const BRAND_BLUE = '#1E3A5F'; // email header (Section 6.6)

// Support both v1.5 (MS_GRAPH_*) and legacy (MICROSOFT_*) env names.
function clientId() {
  return process.env.MS_GRAPH_CLIENT_ID ?? process.env.MICROSOFT_CLIENT_ID ?? '';
}
function clientSecret() {
  return process.env.MS_GRAPH_CLIENT_SECRET ?? process.env.MICROSOFT_CLIENT_SECRET ?? '';
}
function tenantId() {
  return process.env.MS_GRAPH_TENANT_ID ?? process.env.MICROSOFT_TENANT_ID ?? '';
}
function fromEmail() {
  return process.env.MS_GRAPH_FROM_EMAIL ?? process.env.MICROSOFT_SENDER_EMAIL ?? '';
}
function adminEmail(): string {
  return (
    process.env.MS_GRAPH_ADMIN_EMAIL ??
    process.env.EMAIL_ADMIN_EMAIL ??
    fromEmail()
  );
}

// ---------------------------------------------------------------------------
// Token management — persisted to Neon (Section 6.3)
// ---------------------------------------------------------------------------
async function getValidAccessToken(): Promise<string> {
  const account = fromEmail();
  const rows = await db
    .select()
    .from(msGraphTokens)
    .where(eq(msGraphTokens.accountEmail, account))
    .limit(1);

  // Reuse if it expires more than 5 minutes from now.
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (rows[0] && rows[0].expiresAt > fiveMinFromNow) {
    return rows[0].accessToken;
  }

  // Fetch a fresh token via client-credentials.
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId())}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
      cache: 'no-store',
    },
  );
  if (!res.ok) throw new Error(`MS Graph token request failed (${res.status}).`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('MS Graph token response missing access_token.');

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  // Upsert — only ever one row per sending account.
  await db
    .insert(msGraphTokens)
    .values({
      accountEmail: account,
      accessToken: data.access_token,
      refreshToken: '',
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: msGraphTokens.accountEmail,
      set: { accessToken: data.access_token, expiresAt, updatedAt: new Date() },
    });

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------
export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  cc?: string;
  replyTo?: string;
  /** Template label for the send log (Section 6.4). */
  templateName?: string;
  relatedLeadId?: number;
  relatedAgentId?: number;
}

/**
 * Low-level send via MS Graph. Logs every attempt to email_send_log and never
 * throws on a send failure — returns { ok:false } so callers can continue.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; error?: string }> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const templateName = args.templateName ?? 'generic';
  try {
    const token = await getValidAccessToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail())}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: args.subject,
            body: { contentType: 'HTML', content: args.html },
            toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
            ...(args.cc ? { ccRecipients: [{ emailAddress: { address: args.cc } }] } : {}),
            ...(args.replyTo ? { replyTo: [{ emailAddress: { address: args.replyTo } }] } : {}),
          },
          saveToSentItems: true, // also visible in M365 Sent Items (Section 6.4)
        }),
        cache: 'no-store',
      },
    );
    const success = res.status === 202;
    const errorMessage = success ? null : `${res.status} ${await res.text()}`.slice(0, 4000);
    await logSend(recipients[0], args.subject, templateName, success ? 'sent' : 'failed', errorMessage, args);
    if (!success) console.error('[email] MS Graph send failed:', errorMessage);
    return { ok: success, error: errorMessage ?? undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown email error';
    console.error('[email] send threw:', msg);
    await logSend(recipients[0], args.subject, templateName, 'failed', msg, args);
    return { ok: false, error: msg };
  }
}

async function logSend(
  toEmail: string,
  subject: string,
  templateName: string,
  status: 'sent' | 'failed',
  errorMessage: string | null,
  args: SendEmailArgs,
): Promise<void> {
  try {
    await db.insert(emailSendLog).values({
      toEmail,
      subject,
      templateName,
      status,
      errorMessage,
      relatedLeadId: args.relatedLeadId ?? null,
      relatedAgentId: args.relatedAgentId ?? null,
    });
  } catch (err) {
    console.error('[email] failed to write email_send_log:', err);
  }
}

// ---------------------------------------------------------------------------
// Shared HTML shell
// ---------------------------------------------------------------------------
function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:${BRAND_BLUE};padding:20px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">RE/MAX Platinum</span>
        </td></tr>
        <tr><td style="padding:28px;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f5f7fa;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
          RE/MAX Platinum &middot; <a href="${siteUrl()}" style="color:${BRAND_BLUE};">${siteUrl().replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string, bg = BRAND_BLUE): string {
  return `<a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;font-size:15px;">${escapeHtml(label)}</a>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 1. Agent Lead Offer
// ---------------------------------------------------------------------------
export interface AgentOfferEmailData {
  to: string;
  agentName: string;
  leadFirstName: string | null;
  leadCity: string | null;
  leadType: string | null;
  timeframe: string | null;
  valuationRange: string | null;
  deadlineEt: string;
  acceptUrl: string;
  declineUrl: string;
  portalUrl: string;
  relatedLeadId?: number;
  relatedAgentId?: number;
}

export function agentLeadOfferEmail(d: AgentOfferEmailData): SendEmailArgs {
  const who = d.leadFirstName ?? 'A homeowner';
  const loc = d.leadCity ?? 'a nearby area';
  const rows = [
    `<tr><td style="color:#64748b;padding-right:12px;">Lead</td><td><strong>${escapeHtml(d.leadFirstName ?? '—')}</strong> · ${escapeHtml(loc)}</td></tr>`,
    d.leadType ? `<tr><td style="color:#64748b;padding-right:12px;">Type</td><td>${escapeHtml(d.leadType)}</td></tr>` : '',
    d.timeframe ? `<tr><td style="color:#64748b;padding-right:12px;">Timeframe</td><td>${escapeHtml(d.timeframe)}</td></tr>` : '',
    d.valuationRange ? `<tr><td style="color:#64748b;padding-right:12px;">Est. value</td><td>${escapeHtml(d.valuationRange)}</td></tr>` : '',
  ].join('');
  const html = shell(
    'New Lead Available',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">New lead available</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, ${escapeHtml(who)} in <strong>${escapeHtml(loc)}</strong> just requested a home valuation.</p>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">${rows}</table>
     <p style="font-size:15px;line-height:1.5;">Respond by <strong>${escapeHtml(d.deadlineEt)}</strong> to claim it.</p>
     <p style="margin:24px 0;">${button(d.acceptUrl, 'Accept Lead')} &nbsp; ${button(d.declineUrl, 'Decline', '#64748b')}</p>
     <p style="font-size:13px;color:#64748b;">Or manage your leads in the <a href="${d.portalUrl}" style="color:${BRAND_BLUE};">agent portal</a>.</p>`,
  );
  const text = `New lead available near ${loc}.
Lead: ${d.leadFirstName ?? '—'}${d.timeframe ? ` · ${d.timeframe}` : ''}${d.valuationRange ? ` · ${d.valuationRange}` : ''}
Respond by ${d.deadlineEt} to claim it.
Accept: ${d.acceptUrl}
Decline: ${d.declineUrl}
Portal: ${d.portalUrl}`;
  return {
    to: d.to,
    subject: `New Lead Available — ${loc}`,
    html,
    text,
    templateName: 'agent_offer',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 2. Agent Acceptance Confirmation (also used for manual admin assignment)
// ---------------------------------------------------------------------------
export interface AgentAcceptanceEmailData {
  to: string;
  agentName: string;
  leadName: string;
  leadEmail: string | null;
  leadPhone: string | null;
  propertyAddress: string | null;
  portalUrl: string;
  adminAssigned?: boolean; // Section 18.3 #5
  relatedLeadId?: number;
  relatedAgentId?: number;
}

export function agentAcceptanceEmail(d: AgentAcceptanceEmailData): SendEmailArgs {
  const heading = d.adminAssigned ? 'A lead was assigned to you' : 'You accepted this lead';
  const intro = d.adminAssigned
    ? `Hi ${escapeHtml(d.agentName)}, your broker assigned this lead directly to you. Here are the full contact details:`
    : `Hi ${escapeHtml(d.agentName)}, here are the full contact details:`;
  const html = shell(
    heading,
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">${escapeHtml(heading)}</h1>
     <p style="font-size:15px;line-height:1.5;">${intro}</p>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">
       <tr><td style="color:#64748b;padding-right:12px;">Name</td><td><strong>${escapeHtml(d.leadName)}</strong></td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Email</td><td>${escapeHtml(d.leadEmail ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Phone</td><td>${escapeHtml(d.leadPhone ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Property</td><td>${escapeHtml(d.propertyAddress ?? '—')}</td></tr>
     </table>
     <p style="font-size:15px;line-height:1.5;"><strong>Reminder:</strong> submit your first status update within 48 hours.</p>
     <p style="margin:24px 0;">${button(d.portalUrl, 'Open Agent Portal')}</p>`,
  );
  const text = `${heading}.
Name: ${d.leadName}
Email: ${d.leadEmail ?? '—'}
Phone: ${d.leadPhone ?? '—'}
Property: ${d.propertyAddress ?? '—'}
Reminder: submit your first status update within 48 hours.
Portal: ${d.portalUrl}`;
  return {
    to: d.to,
    subject: `${d.adminAssigned ? 'Lead assigned' : 'Lead accepted'} — ${d.leadName}`,
    html,
    text,
    templateName: d.adminAssigned ? 'agent_manual_assignment' : 'agent_acceptance',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 3. Homeowner Confirmation
// ---------------------------------------------------------------------------
export interface HomeownerConfirmationEmailData {
  to: string;
  firstName: string | null;
  city: string | null;
  relatedLeadId?: number;
  reportUrl?: string | null; // durable link to the personalized market report
}

export function homeownerConfirmationEmail(d: HomeownerConfirmationEmailData): SendEmailArgs {
  const hi = d.firstName ? `Hi ${escapeHtml(d.firstName)},` : 'Hi,';
  const reportBlock = d.reportUrl
    ? `<p style="font-size:15px;line-height:1.5;">In the meantime, view your personalized market report — your estimated value, similar homes for sale, recent nearby sales, and local market trends:</p>
       <p style="margin:20px 0;">${button(d.reportUrl, 'View your market report')}</p>`
    : '';
  const html = shell(
    'We received your request',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">Thanks — we got your request</h1>
     <p style="font-size:15px;line-height:1.5;">${hi}</p>
     <p style="font-size:15px;line-height:1.5;">Your home valuation request${d.city ? ` for ${escapeHtml(d.city)}` : ''} has been received. A local RE/MAX Platinum expert will be in touch within one business day to review your personalized market report.</p>
     ${reportBlock}
     <p style="font-size:15px;line-height:1.5;">Talk soon,<br>The RE/MAX Platinum Team</p>`,
  );
  const text = `${hi}
Your home valuation request${d.city ? ` for ${d.city}` : ''} has been received. A local RE/MAX Platinum expert will be in touch within one business day.
${d.reportUrl ? `\nView your personalized market report: ${d.reportUrl}\n` : ''}— The RE/MAX Platinum Team`;
  return {
    to: d.to,
    subject: 'We received your home valuation request',
    html,
    text,
    templateName: 'homeowner_confirmation',
    relatedLeadId: d.relatedLeadId,
  };
}

// ---------------------------------------------------------------------------
// 4. 48-Hour Escalation Alert (to admin)
// ---------------------------------------------------------------------------
export interface EscalationEmailData {
  agentName: string;
  leadName: string;
  propertyAddress: string | null;
  hoursSinceAccept: number;
  adminLeadUrl: string;
  relatedLeadId?: number;
}

export function escalationEmail(d: EscalationEmailData): SendEmailArgs {
  const html = shell(
    'Lead needs attention',
    `<h1 style="margin:0 0 12px;font-size:22px;color:#DC1C2E;">48-hour escalation</h1>
     <p style="font-size:15px;line-height:1.5;"><strong>${escapeHtml(d.agentName)}</strong> has not submitted a first status update within 48 hours of accepting a lead.</p>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">
       <tr><td style="color:#64748b;padding-right:12px;">Lead</td><td>${escapeHtml(d.leadName)}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Property</td><td>${escapeHtml(d.propertyAddress ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Hours since accept</td><td>${d.hoursSinceAccept}</td></tr>
     </table>
     <p style="margin:24px 0;">${button(d.adminLeadUrl, 'View Lead')}</p>`,
  );
  const text = `48-hour escalation: ${d.agentName} has not submitted a first status update within 48h.
Lead: ${d.leadName}
Property: ${d.propertyAddress ?? '—'}
Hours since accept: ${d.hoursSinceAccept}
View: ${d.adminLeadUrl}`;
  return {
    to: adminEmail(),
    subject: `Escalation: ${d.agentName} — ${d.leadName}`,
    html,
    text,
    templateName: 'escalation',
    relatedLeadId: d.relatedLeadId,
  };
}

// ---------------------------------------------------------------------------
// 5. Weekly Agent Reminder
// ---------------------------------------------------------------------------
export interface WeeklyReminderEmailData {
  to: string;
  agentName: string;
  openLeadCount: number;
  portalUrl: string;
  relatedAgentId?: number;
}

export function weeklyReminderEmail(d: WeeklyReminderEmailData): SendEmailArgs {
  const html = shell(
    'Open leads need an update',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">You have open leads</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, you have <strong>${d.openLeadCount}</strong> open lead${d.openLeadCount === 1 ? '' : 's'} that need a status update.</p>
     <p style="margin:24px 0;">${button(d.portalUrl, 'Update Your Leads')}</p>`,
  );
  const text = `Hi ${d.agentName}, you have ${d.openLeadCount} open lead(s) needing a status update.
Portal: ${d.portalUrl}`;
  return {
    to: d.to,
    subject: 'Your open leads need a status update',
    html,
    text,
    templateName: 'weekly_reminder',
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 6. Thursday Broker Digest (to admin)
// ---------------------------------------------------------------------------
export interface DigestRow {
  agentName: string;
  leadName: string;
  propertyAddress: string | null;
  daysSinceAccept: number;
  status: string;
}

export function brokerDigestEmail(rows: DigestRow[], adminUrl: string): SendEmailArgs {
  const tableRows = rows
    .map(
      (r) =>
        `<tr>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.leadName)}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.propertyAddress ?? '—')}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.agentName)}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;">${r.daysSinceAccept}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.status)}</td>
         </tr>`,
    )
    .join('');
  const html = shell(
    'Weekly Broker Digest',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">Active accepted leads</h1>
     <p style="font-size:15px;line-height:1.5;">${rows.length} active accepted lead${rows.length === 1 ? '' : 's'} this week.</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
       <thead><tr style="text-align:left;color:#64748b;">
         <th style="padding:8px;">Lead</th><th style="padding:8px;">Address</th><th style="padding:8px;">Agent</th>
         <th style="padding:8px;text-align:center;">Days</th><th style="padding:8px;">Status</th>
       </tr></thead>
       <tbody>${tableRows || '<tr><td colspan="5" style="padding:8px;color:#64748b;">No active accepted leads.</td></tr>'}</tbody>
     </table>
     <p style="margin:24px 0;">${button(adminUrl, 'Open Admin Dashboard')}</p>`,
  );
  const text =
    `Weekly Broker Digest — ${rows.length} active accepted leads\n\n` +
    rows
      .map((r) => `- ${r.leadName} | ${r.propertyAddress ?? '—'} | ${r.agentName} | ${r.daysSinceAccept}d | ${r.status}`)
      .join('\n') +
    `\n\nAdmin: ${adminUrl}`;
  return {
    to: adminEmail(),
    subject: 'Weekly Broker Digest — Active Leads',
    html,
    text,
    templateName: 'broker_digest',
  };
}

// ---------------------------------------------------------------------------
// 7. Appointment Request Notification (to admin)
// ---------------------------------------------------------------------------
export interface AppointmentEmailData {
  name: string;
  phone: string | null;
  email: string | null;
  preferredTime: string | null;
  notes: string | null;
}

export function appointmentNotificationEmail(d: AppointmentEmailData): SendEmailArgs {
  const html = shell(
    'New appointment request',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">New appointment request</h1>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">
       <tr><td style="color:#64748b;padding-right:12px;">Name</td><td><strong>${escapeHtml(d.name)}</strong></td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Phone</td><td>${escapeHtml(d.phone ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Email</td><td>${escapeHtml(d.email ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Preferred time</td><td>${escapeHtml(d.preferredTime ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Notes</td><td>${escapeHtml(d.notes ?? '—')}</td></tr>
     </table>`,
  );
  const text = `New appointment request
Name: ${d.name}
Phone: ${d.phone ?? '—'}
Email: ${d.email ?? '—'}
Preferred time: ${d.preferredTime ?? '—'}
Notes: ${d.notes ?? '—'}`;
  return {
    to: adminEmail(),
    subject: `Appointment request — ${d.name}`,
    html,
    text,
    templateName: 'appointment_request',
  };
}

/** Generic admin alert (used when no agent could be found for a lead). */
export function adminAlertEmail(subject: string, message: string): SendEmailArgs {
  const html = shell(subject, `<p style="font-size:15px;line-height:1.5;">${escapeHtml(message)}</p>`);
  return { to: adminEmail(), subject, html, text: message, templateName: 'admin_alert' };
}

// ---------------------------------------------------------------------------
// 8. Lead resubmitted — to the agent working the lead (v1.6 §D.2)
// ---------------------------------------------------------------------------
export interface LeadResubmittedEmailData {
  to: string;
  agentName: string;
  leadName: string;
  propertyAddress: string | null;
  email: string | null;
  phone: string | null;
  relatedLeadId?: number;
  relatedAgentId?: number;
}

export function leadResubmittedEmail(d: LeadResubmittedEmailData): SendEmailArgs {
  const html = shell(
    'A lead you are working resubmitted',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">Lead resubmitted</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, <strong>${escapeHtml(d.leadName)}</strong>${
       d.propertyAddress ? ` at ${escapeHtml(d.propertyAddress)}` : ''
     } submitted again. Their contact info may have updated:</p>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">
       <tr><td style="color:#64748b;padding-right:12px;">Email</td><td>${escapeHtml(d.email ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Phone</td><td>${escapeHtml(d.phone ?? '—')}</td></tr>
     </table>`,
  );
  const text = `Lead resubmitted: ${d.leadName}${d.propertyAddress ? ` at ${d.propertyAddress}` : ''}.
Email: ${d.email ?? '—'} | Phone: ${d.phone ?? '—'}`;
  return {
    to: d.to,
    subject: `Lead resubmitted — ${d.leadName}`,
    html,
    text,
    templateName: 'lead_resubmitted',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 9. Stale lead warning (36h / 12h-to-penalty) — to the agent (v1.6 §E.6)
// ---------------------------------------------------------------------------
export interface StaleWarningEmailData {
  to: string;
  agentName: string;
  leadName: string;
  address: string | null;
  penaltyInHours: number;
  portalUrl: string;
  relatedLeadId?: number;
  relatedAgentId?: number;
}

export function staleLeadWarningEmail(d: StaleWarningEmailData): SendEmailArgs {
  const html = shell(
    'Status update needed',
    `<h1 style="margin:0 0 12px;font-size:22px;color:#DC1C2E;">Status update due in ${d.penaltyInHours} hours</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, please submit a status update on <strong>${escapeHtml(
       d.leadName,
     )}</strong>${d.address ? ` at ${escapeHtml(d.address)}` : ''} within ${d.penaltyInHours} hours to avoid a score penalty.</p>
     <p style="margin:24px 0;">${button(d.portalUrl, 'Update This Lead')}</p>`,
  );
  const text = `Status update due in ${d.penaltyInHours} hours for ${d.leadName}${
    d.address ? ` at ${d.address}` : ''
  }. Portal: ${d.portalUrl}`;
  return {
    to: d.to,
    subject: `Action needed: Status update due in ${d.penaltyInHours} hours`,
    html,
    text,
    templateName: 'stale_warning',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

/** 6-day recurring warning (24h-to-penalty) — to the agent (v1.6 §E.6). */
export function stale6DayWarningEmail(d: Omit<StaleWarningEmailData, 'penaltyInHours'>): SendEmailArgs {
  const html = shell(
    'Recurring status update needed',
    `<h1 style="margin:0 0 12px;font-size:22px;color:#DC1C2E;">Recurring penalty in 24 hours</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, <strong>${escapeHtml(
       d.leadName,
     )}</strong>${d.address ? ` at ${escapeHtml(d.address)}` : ''} still needs a status update. A recurring score penalty applies in 24 hours.</p>
     <p style="margin:24px 0;">${button(d.portalUrl, 'Update This Lead')}</p>`,
  );
  const text = `Recurring penalty in 24 hours for ${d.leadName}. Portal: ${d.portalUrl}`;
  return {
    to: d.to,
    subject: 'Reminder: Recurring status update penalty in 24 hours',
    html,
    text,
    templateName: 'stale_6day_warning',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 10. Lead deleted — penalties reversed (v1.6 §E.7) — to the agent
// ---------------------------------------------------------------------------
export interface LeadDeletedEmailData {
  to: string;
  agentName: string;
  leadName: string;
  note?: string | null;
  relatedLeadId?: number;
  relatedAgentId?: number;
}

export function leadDeletedNotificationEmail(d: LeadDeletedEmailData): SendEmailArgs {
  const html = shell(
    'A lead was removed',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">A lead was removed</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, the lead <strong>${escapeHtml(
       d.leadName,
     )}</strong> has been removed by your broker. Any score penalties related to this lead have been reversed.</p>
     ${d.note ? `<p style="font-size:13px;color:#64748b;">${escapeHtml(d.note)}</p>` : ''}`,
  );
  const text = `The lead ${d.leadName} was removed. Any related score penalties have been reversed.`;
  return {
    to: d.to,
    subject: `Lead removed — ${d.leadName}`,
    html,
    text,
    templateName: 'lead_deleted',
    relatedLeadId: d.relatedLeadId,
    relatedAgentId: d.relatedAgentId,
  };
}

// ---------------------------------------------------------------------------
// 11. RentCast monthly quota alert (40/50) — to admin (v1.6 §H.3)
// ---------------------------------------------------------------------------
export function rentcastQuotaAlertEmail(used: number, limit: number): SendEmailArgs {
  const html = shell(
    'RentCast API usage',
    `<h1 style="margin:0 0 12px;font-size:22px;color:#DC1C2E;">RentCast: ${used}/${limit} free calls used</h1>
     <p style="font-size:15px;line-height:1.5;">You have used <strong>${used}</strong> of your <strong>${limit}</strong> free RentCast API calls this month (${Math.round(
       (used / limit) * 100,
     )}%). Consider upgrading before you hit the limit.</p>`,
  );
  const text = `RentCast: ${used}/${limit} free calls used this month.`;
  return {
    to: adminEmail(),
    subject: `RentCast API: ${used}/${limit} free calls used this month`,
    html,
    text,
    templateName: 'rentcast_quota_alert',
  };
}
