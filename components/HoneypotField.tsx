'use client';

import * as React from 'react';
import { HONEYPOT_FIELD } from '@/lib/abuseMitigation';

/**
 * The hidden honeypot input (P0.3, decision D5 MODIFIED).
 *
 * A naive form-filling bot walks the DOM and fills every input it finds; a
 * human never sees this one, so any value coming back is a strong bot signal
 * with no innocent explanation. Zero friction for real users — nothing to
 * solve, nothing to click, no third-party script.
 *
 * The details matter for avoiding FALSE POSITIVES, which would silently discard
 * real seller leads:
 *   - positioned off-screen rather than `display:none`, since some bots
 *     specifically skip display:none fields (and some browsers skip them too);
 *   - `aria-hidden` + `tabIndex={-1}` so assistive tech and keyboard users
 *     never reach it;
 *   - `autoComplete="off"` and a name password managers won't recognise as a
 *     real field, so autofill can't populate it on a human's behalf.
 */
export default function HoneypotField() {
  return (
    <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
      <label htmlFor={HONEYPOT_FIELD}>Company (leave this field empty)</label>
      <input
        id={HONEYPOT_FIELD}
        name={HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  );
}

/**
 * Capture the moment the form rendered, for the minimum-completion-time check.
 * A ref (not state) so reading it never triggers a re-render.
 */
export function useFormLoadedAt(): React.MutableRefObject<number> {
  const ref = React.useRef(0);
  React.useEffect(() => {
    // Set on mount rather than at module load: a form inside a modal is
    // "rendered" when the modal opens, not when the bundle evaluated.
    ref.current = Date.now();
  }, []);
  return ref;
}

/** Read the honeypot's current value out of the enclosing form. */
export function readHoneypot(form: HTMLFormElement | null): string {
  if (!form) return '';
  const el = form.elements.namedItem(HONEYPOT_FIELD);
  return el instanceof HTMLInputElement ? el.value : '';
}
