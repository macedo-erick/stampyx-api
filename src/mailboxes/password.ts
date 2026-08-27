import { randomBytes } from 'node:crypto';

import * as argon2 from 'argon2';

export const DOVECOT_SCHEME = '{ARGON2ID}';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashMailboxPassword(plaintext: string): Promise<string> {
  return `${DOVECOT_SCHEME}${await argon2.hash(plaintext, OPTIONS)}`;
}

export async function verifyMailboxPassword(stored: string, plaintext: string): Promise<boolean> {
  const encoded = stored.startsWith(DOVECOT_SCHEME) ? stored.slice(DOVECOT_SCHEME.length) : stored;

  try {
    return await argon2.verify(encoded, plaintext);
  } catch {
    return false;
  }
}

export async function unusableMailboxPassword(): Promise<string> {
  return hashMailboxPassword(randomBytes(32).toString('base64url'));
}
