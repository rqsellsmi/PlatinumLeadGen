'use client';

import * as React from 'react';
import Link from 'next/link';
import SignInModal, { openBuyerSignIn } from './SignInModal';
import RepresentationModal from './RepresentationModal';

/** Header affordance: "Sign in" (opens the modal) or "My Account" + sign out.
 *  Also auto-opens the modal when redirected here with ?signin=1 (guarded pages). */
export default function BuyerAuthNav() {
  const [me, setMe] = React.useState<{ signedIn: boolean; name?: string | null } | null>(null);

  React.useEffect(() => {
    fetch('/api/buyer/me')
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ signedIn: false }));
  }, []);

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('signin') === '1') openBuyerSignIn(p.get('next') || '/account');
  }, []);

  async function signOut() {
    try {
      await fetch('/api/buyer/auth/signout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    window.location.href = '/';
  }

  return (
    <>
      {me?.signedIn ? (
        <>
          <Link href="/account" className="hover:text-platinum-blue">
            My Account
          </Link>
          <button type="button" onClick={signOut} className="hidden text-mute hover:text-charcoal sm:inline">
            Sign out
          </button>
        </>
      ) : (
        <button type="button" onClick={() => openBuyerSignIn('/account')} className="hover:text-platinum-blue">
          Sign in
        </button>
      )}
      <SignInModal />
      <RepresentationModal />
    </>
  );
}
