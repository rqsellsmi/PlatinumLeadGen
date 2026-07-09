/**
 * NextAuth.js v5 config (Section 10.1).
 * Credentials provider — admin username/password from env vars only.
 * No user table: ADMIN_USERNAME + ADMIN_PASSWORD_HASH (bcrypt, cost 12).
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/admin/login',
  },
  providers: [
    Credentials({
      name: 'Admin',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const expectedUser = process.env.ADMIN_USERNAME;
        const passwordHash = process.env.ADMIN_PASSWORD_HASH;
        if (!expectedUser || !passwordHash) {
          console.error('[auth] ADMIN_USERNAME or ADMIN_PASSWORD_HASH not configured');
          return null;
        }
        // TEMP DEBUG (remove after diagnosing local login) — prints to the
        // terminal running `npm run dev`, never to the browser.
        const ok = await bcrypt.compare(password, passwordHash);
        console.error(
          '[auth-debug] recvUser=%j expectedUser=%j userMatch=%s | hashLen=%s hashStart=%j | bcrypt=%s',
          username,
          expectedUser,
          username === expectedUser,
          passwordHash?.length,
          passwordHash?.slice(0, 4),
          ok,
        );

        if (username !== expectedUser) return null;
        if (!ok) return null;

        return { id: 'admin', name: username, email: null };
      },
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
