/**
 * Admin heads-up when a new lead's phone matches an existing, different-email
 * lead (D3, email-primary model).
 *
 * Email is the identity key, so this new submission is correctly routed as its
 * OWN lead. But a shared phone number is worth a human look: it might be the
 * same seller who changed email addresses, or a recycled/shared number that
 * belongs to two different people. Only the ADMIN can resolve it — an agent
 * sees only their own leads and cannot tell who owns the matching record — so
 * the notice goes to the admin, with links to both leads. The agent then
 * confirms the correct email directly with the client; there is no automated
 * merge.
 *
 * Best-effort: never throws into the request path.
 */
import { sendEmail, adminAlertEmail } from './email';
import { siteUrl } from './siteUrl';
import { findLeadByPhone } from './leadDedup';
import { sameEmailIdentity } from './contactNormalization';

export interface NewLeadForCollisionCheck {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export async function alertAdminOfPhoneCollision(newLead: NewLeadForCollisionCheck): Promise<void> {
  try {
    const twin = await findLeadByPhone(newLead.phone, newLead.id);
    if (!twin) return;
    // If the emails match this is the SAME lead by identity and would already
    // have deduped upstream — nothing to flag. Only a DIFFERENT email (or a
    // twin with no email) is the shared-number case worth a look.
    if (sameEmailIdentity(newLead.email, twin.email)) return;

    const name = `${newLead.firstName ?? ''} ${newLead.lastName ?? ''}`.trim() || 'New lead';
    const base = siteUrl();
    const message = [
      `New lead #${newLead.id} (${name}) shares a phone number with existing lead #${twin.id}.`,
      '',
      'The email addresses differ, so the new submission was routed as its own lead ' +
        '(email is the identity key). This is a heads-up to check whether it is the same ' +
        'seller with a new email address, or a shared/recycled number belonging to two people. ' +
        'If it is the same person, confirm the correct email with the client before merging.',
      '',
      `New lead:     ${base}/admin/leads/${newLead.id}   (${newLead.email ?? 'no email'} · ${newLead.phone ?? 'no phone'})`,
      `Matched lead: ${base}/admin/leads/${twin.id}   (${twin.email ?? 'no email'})`,
    ].join('\n');

    await sendEmail(adminAlertEmail('Phone number matches another lead', message));
  } catch (err) {
    console.error('[leadDuplicateAlert] phone-collision check failed:', err);
  }
}
