'use client';

import * as React from 'react';

/**
 * A form that clears its fields after a successful server action. Server-action
 * forms with uncontrolled inputs don't reset on their own, which lets a
 * just-submitted "create" form be accidentally re-submitted (e.g. adding the
 * same office twice). Wrapping the create form in this fixes that.
 */
export default function ResetOnSubmitForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (formData) => {
        await action(formData);
        ref.current?.reset();
      }}
      className={className}
    >
      {children}
    </form>
  );
}
