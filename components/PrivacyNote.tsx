import Link from 'next/link';
import {
  PRIVACY_DISCLOSURE,
  ADDRESS_STEP_DISCLOSURE,
  PRIVACY_POLICY_PATH,
} from '@/lib/disclosures';

/**
 * The form-adjacent privacy disclosure (P0.6, review #19/#20).
 *
 * Placed immediately beside every submit button, with a live link to the
 * policy. One component so the copy cannot drift back into four different
 * promises — see lib/disclosures.ts for what it used to say and why that was
 * wrong.
 */
export default function PrivacyNote({
  variant = 'submit',
  className = '',
}: {
  /** `submit` beside a contact-collecting button; `address` beside the address step (D8). */
  variant?: 'submit' | 'address';
  className?: string;
}) {
  const text = variant === 'address' ? ADDRESS_STEP_DISCLOSURE : PRIVACY_DISCLOSURE;
  // Link the trailing "Privacy Policy" mention rather than appending a second,
  // redundant link after the sentence.
  const [before, after] = text.split('Privacy Policy');

  return (
    <p className={`text-xs leading-relaxed text-mute-light ${className}`}>
      {before}
      <Link
        href={PRIVACY_POLICY_PATH}
        className="underline decoration-1 underline-offset-2 hover:text-charcoal"
      >
        Privacy Policy
      </Link>
      {after}
    </p>
  );
}
