/**
 * NextAuth.js v5 catch-all route handler.
 * Exposes GET/POST for sign-in, callback, session, and CSRF endpoints.
 */
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
