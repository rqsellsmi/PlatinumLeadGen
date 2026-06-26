/**
 * CLI utility: takes a plaintext password and prints a bcrypt hash (cost 12).
 * Used to generate ADMIN_PASSWORD_HASH and to set agent passwords.
 *
 * Usage:
 *   npm run hash-password -- 'myPlaintextPassword'
 *   tsx scripts/hash-password.ts 'myPlaintextPassword'
 */
import bcrypt from 'bcryptjs';

const COST = 12;

async function main() {
  const plaintext = process.argv[2];
  if (!plaintext) {
    console.error('Usage: tsx scripts/hash-password.ts <plaintext-password>');
    process.exit(1);
  }
  const hash = await bcrypt.hash(plaintext, COST);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
