import { randomBytes } from 'node:crypto';

import * as argon2 from 'argon2';

// Without this prefix Dovecot falls back to its default scheme and every login fails with
// no useful log line.
export const DOVECOT_SCHEME = '{ARGON2ID}';

// Dovecot's own argon2id defaults, so a hash written here stays verifiable if it rehashes.
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

// A consumer's panel login is Keycloak, so their mailbox starts with no usable mail password
// at all. This fills the NOT NULL column with something nobody holds: IMAP and SMTP refuse
// the mailbox until the owner sets a real one from the panel.
export async function unusableMailboxPassword(): Promise<string> {
  return hashMailboxPassword(randomBytes(32).toString('base64url'));
}
