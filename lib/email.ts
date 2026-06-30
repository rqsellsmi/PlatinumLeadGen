/**
 * Microsoft Graph wrapper + all 7 transactional templates (Section 6).
 *
 * Every email: clean single-column HTML, brand-blue (#1E3A5F) header, white body,
 * with a required plain-text fallback.
 *
 * TODO v2: add Twilio SMS alongside sendEmail.
 */
const BRAND_BLUE = '#1E3A5F';

function adminEmail(): string {
  return process.env.EMAIL_ADMIN_EMAIL ?? process.env.MICROSOFT_SENDER_EMAIL ?? '';
}

function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://remax-platinumonline.com';
}

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

async function graphAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const tenantId = process.env.MICROSOFT_TENANT_ID!;
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
      cache: 'no-store',
    },
  );

  if (!response.ok) throw new Error(`Microsoft token request failed (${response.status}).`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Microsoft token response did not include an access token.');

  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/**
 * Low-level send. Returns { id } on success. Never throws on a send failure —
 * logs and returns { error } so callers (cron, autoOffer) can continue.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ id?: string; error?: string }> {
  try {
    const token = await graphAccessToken();
    const sender = process.env.MICROSOFT_SENDER_EMAIL!;
    const recipients = Array.isArray(args.to) ? args.to : [args.to];
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: args.subject,
            body: { contentType: 'HTML', content: args.html },
            toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
            ...(args.replyTo
              ? { replyTo: [{ emailAddress: { address: args.replyTo } }] }
              : {}),
          },
          saveToSentItems: true,
        }),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error('[email] Microsoft Graph send failed:', response.status, detail);
      return { error: `Microsoft Graph send failed (${response.status}).` };
    }

    return {
      id: response.headers.get('request-id') ?? response.headers.get('client-request-id') ?? 'accepted',
    };
  } catch (err) {
    console.error('[email] send threw:', err);
    return { error: err instanceof Error ? err.message : 'unknown email error' };
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
  leadCity: string | null;
  propertyAddress: string | null;
  deadlineEt: string; // human-readable ET deadline
  acceptUrl: string;
  declineUrl: string;
  portalUrl: string;
}

export function agentLeadOfferEmail(d: AgentOfferEmailData): SendEmailArgs {
  const loc = d.propertyAddress ?? d.leadCity ?? 'a nearby area';
  const html = shell(
    'New Lead Available',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">New lead available</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, a new seller lead is available near <strong>${escapeHtml(loc)}</strong>.</p>
     <p style="font-size:15px;line-height:1.5;">Respond by <strong>${escapeHtml(d.deadlineEt)}</strong> to claim it.</p>
     <p style="margin:24px 0;">${button(d.acceptUrl, 'Accept Lead')} &nbsp; ${button(d.declineUrl, 'Decline', '#64748b')}</p>
     <p style="font-size:13px;color:#64748b;">Or manage your leads in the <a href="${d.portalUrl}" style="color:${BRAND_BLUE};">agent portal</a>.</p>`,
  );
  const text = `New lead available near ${loc}.
Respond by ${d.deadlineEt} to claim it.
Accept: ${d.acceptUrl}
Decline: ${d.declineUrl}
Portal: ${d.portalUrl}`;
  return { to: d.to, subject: `New Lead Available — ${loc}`, html, text };
}

// ---------------------------------------------------------------------------
// 2. Agent Acceptance Confirmation
// ---------------------------------------------------------------------------
export interface AgentAcceptanceEmailData {
  to: string;
  agentName: string;
  leadName: string;
  leadEmail: string | null;
  leadPhone: string | null;
  propertyAddress: string | null;
  portalUrl: string;
}

export function agentAcceptanceEmail(d: AgentAcceptanceEmailData): SendEmailArgs {
  const html = shell(
    'Lead Accepted',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">You accepted this lead</h1>
     <p style="font-size:15px;line-height:1.5;">Hi ${escapeHtml(d.agentName)}, here are the full contact details:</p>
     <table style="font-size:15px;line-height:1.8;margin:12px 0;">
       <tr><td style="color:#64748b;padding-right:12px;">Name</td><td><strong>${escapeHtml(d.leadName)}</strong></td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Email</td><td>${escapeHtml(d.leadEmail ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Phone</td><td>${escapeHtml(d.leadPhone ?? '—')}</td></tr>
       <tr><td style="color:#64748b;padding-right:12px;">Property</td><td>${escapeHtml(d.propertyAddress ?? '—')}</td></tr>
     </table>
     <p style="font-size:15px;line-height:1.5;"><strong>Reminder:</strong> submit your first status update within 48 hours.</p>
     <p style="margin:24px 0;">${button(d.portalUrl, 'Open Agent Portal')}</p>`,
  );
  const text = `You accepted a lead.
Name: ${d.leadName}
Email: ${d.leadEmail ?? '—'}
Phone: ${d.leadPhone ?? '—'}
Property: ${d.propertyAddress ?? '—'}
Reminder: submit your first status update within 48 hours.
Portal: ${d.portalUrl}`;
  return { to: d.to, subject: `Lead accepted — ${d.leadName}`, html, text };
}

// ---------------------------------------------------------------------------
// 3. Homeowner Confirmation
// ---------------------------------------------------------------------------
export interface HomeownerConfirmationEmailData {
  to: string;
  firstName: string | null;
  city: string | null;
}

export function homeownerConfirmationEmail(d: HomeownerConfirmationEmailData): SendEmailArgs {
  const hi = d.firstName ? `Hi ${escapeHtml(d.firstName)},` : 'Hi,';
  const html = shell(
    'We received your request',
    `<h1 style="margin:0 0 12px;font-size:22px;color:${BRAND_BLUE};">Thanks — we got your request</h1>
     <p style="font-size:15px;line-height:1.5;">${hi}</p>
     <p style="font-size:15px;line-height:1.5;">Your home valuation request${d.city ? ` for ${escapeHtml(d.city)}` : ''} has been received. A local RE/MAX Platinum expert will be in touch within one business day to review your personalized market report.</p>
     <p style="font-size:15px;line-height:1.5;">Talk soon,<br>The RE/MAX Platinum Team</p>`,
  );
  const text = `${hi}
Your home valuation request${d.city ? ` for ${d.city}` : ''} has been received. A local RE/MAX Platinum expert will be in touch within one business day.
— The RE/MAX Platinum Team`;
  return { to: d.to, subject: 'We received your home valuation request', html, text };
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
  return { to: adminEmail(), subject: `Escalation: ${d.agentName} — ${d.leadName}`, html, text };
}

// ---------------------------------------------------------------------------
// 5. Weekly Agent Reminder
// ---------------------------------------------------------------------------
export interface WeeklyReminderEmailData {
  to: string;
  agentName: string;
  openLeadCount: number;
  portalUrl: string;
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
  return { to: d.to, subject: 'Your open leads need a status update', html, text };
}

// ---------------------------------------------------------------------------
// 6. Thursday Broker Digest (to admin)
// ---------------------------------------------------------------------------
export interface DigestRow {
  agentName: string;
  leadName: string;
  daysSinceAccept: number;
  status: string;
}

export function brokerDigestEmail(rows: DigestRow[], adminUrl: string): SendEmailArgs {
  const tableRows = rows
    .map(
      (r) =>
        `<tr>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.agentName)}</td>
           <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.leadName)}</td>
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
         <th style="padding:8px;">Agent</th><th style="padding:8px;">Lead</th>
         <th style="padding:8px;text-align:center;">Days</th><th style="padding:8px;">Status</th>
       </tr></thead>
       <tbody>${tableRows || '<tr><td colspan="4" style="padding:8px;color:#64748b;">No active accepted leads.</td></tr>'}</tbody>
     </table>
     <p style="margin:24px 0;">${button(adminUrl, 'Open Admin Dashboard')}</p>`,
  );
  const text =
    `Weekly Broker Digest — ${rows.length} active accepted leads\n\n` +
    rows
      .map((r) => `- ${r.agentName} | ${r.leadName} | ${r.daysSinceAccept}d | ${r.status}`)
      .join('\n') +
    `\n\nAdmin: ${adminUrl}`;
  return { to: adminEmail(), subject: 'Weekly Broker Digest — Active Leads', html, text };
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
  return { to: adminEmail(), subject: `Appointment request — ${d.name}`, html, text };
}

/** Generic admin alert (used when no agent could be found for a lead). */
export function adminAlertEmail(subject: string, message: string): SendEmailArgs {
  const html = shell(subject, `<p style="font-size:15px;line-height:1.5;">${escapeHtml(message)}</p>`);
  return { to: adminEmail(), subject, html, text: message };
}
