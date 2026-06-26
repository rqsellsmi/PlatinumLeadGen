import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Guard for admin pages. Call at the top of every admin page EXCEPT the login
 * page. Redirects to /admin/login when there is no authenticated session.
 * Defense-in-depth alongside middleware.ts which already blocks /admin/*.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session) redirect('/admin/login');
  return session;
}
