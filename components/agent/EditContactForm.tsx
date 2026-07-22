'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@/components/ui';

/**
 * Inline editor for the contact details on a lead the agent owns. Renders the
 * read-only "Contact & property" summary (passed as children) until the agent
 * clicks Edit, then swaps in a form that POSTs to /api/agent/lead. Names, email
 * and phone are the only editable fields; property data stays read-only.
 */
export function EditContactForm({
  leadOfferId,
  initial,
  children,
}: {
  leadOfferId: number;
  initial: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  /** The read-only summary shown when not editing. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFirstName(initial.firstName);
    setLastName(initial.lastName);
    setEmail(initial.email);
    setPhone(initial.phone);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadOfferId,
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim(),
          phone: phone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message || 'Could not save your changes. Check the details and try again.');
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not save your changes. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-bold text-charcoal">Contact &amp; property</h2>
          <button
            type="button"
            onClick={() => {
              reset();
              setEditing(true);
            }}
            className="text-sm font-semibold text-platinum-blue hover:underline"
          >
            Edit contact
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-bold text-charcoal">Edit contact</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-platinum-red">{error}</p>
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-sm font-semibold text-mute hover:text-charcoal"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
