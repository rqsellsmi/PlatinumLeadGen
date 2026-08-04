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
  onDark = false,
  collapsible = false,
  summaryLabel = 'How we use your address',
  className = '',
}: {
  /** `submit` beside a contact-collecting button; `address` beside the address step (D8). */
  variant?: 'submit' | 'address';
  /** Render on a DARK background (e.g. the hero image): light text + link. */
  onDark?: boolean;
  /** Show as a tap-to-expand disclosure (native <details>) instead of always-on text. */
  collapsible?: boolean;
  /** Trigger label when `collapsible`. */
  summaryLabel?: string;
  className?: string;
}) {
  const text = variant === 'address' ? ADDRESS_STEP_DISCLOSURE : PRIVACY_DISCLOSURE;
  // Link the trailing "Privacy Policy" mention rather than appending a second,
  // redundant link after the sentence.
  const [before, after] = text.split('Privacy Policy');
  const textColor = onDark ? 'text-white/70' : 'text-mute-light';
  const linkHover = onDark ? 'hover:text-white' : 'hover:text-charcoal';

  const body = (
    <>
      {before}
      <Link
        href={PRIVACY_POLICY_PATH}
        className={`underline decoration-1 underline-offset-2 ${linkHover}`}
      >
        Privacy Policy
      </Link>
      {after}
    </>
  );

  // Native <details> — accessible and needs no client JS. The default marker is
  // hidden (Firefox via list-none, WebKit via the pseudo-element) so the summary
  // reads as a plain underlined link.
  if (collapsible) {
    return (
      <details className={`text-xs leading-relaxed ${textColor} ${className}`}>
        <summary
          className={`cursor-pointer list-none underline decoration-1 underline-offset-2 [&::-webkit-details-marker]:hidden ${linkHover}`}
        >
          {summaryLabel}
        </summary>
        <p className="mt-1.5">{body}</p>
      </details>
    );
  }

  return <p className={`text-xs leading-relaxed ${textColor} ${className}`}>{body}</p>;
}
