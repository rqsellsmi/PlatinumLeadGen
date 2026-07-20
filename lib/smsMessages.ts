/** Persist and update SMS message rows (design spec §4.2). Best-effort; swallows errors. */
import { eq } from 'drizzle-orm';
import { db } from './db';
import { smsMessages, type NewSmsMessage } from '@/drizzle/schema';

export async function logSmsMessage(row: NewSmsMessage): Promise<void> {
  try {
    await db.insert(smsMessages).values(row);
  } catch (err) {
    console.error('[sms] logSmsMessage failed:', err);
  }
}

export async function updateSmsStatusByTelnyxId(
  telnyxMessageId: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  try {
    await db
      .update(smsMessages)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(smsMessages.telnyxMessageId, telnyxMessageId));
  } catch (err) {
    console.error('[sms] updateSmsStatusByTelnyxId failed:', err);
  }
}
