import { z } from 'zod';

// Typed into mail clients, not a Keycloak-backed browser, so nothing else enforces length.
// 12 matches the realm policy.
const password = z.string().min(12).max(200);

// RFC 5321 caps the local part at 64 octets; the dot rules are RFC 5322.
const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/,
    'must be a valid mailbox name',
  );

export const createMailboxSchema = z.object({
  localPart,
  password,
  quotaMb: z.coerce.number().int().min(1).max(102_400).default(1024),
});
export type CreateMailboxRequest = z.infer<typeof createMailboxSchema>;

export const setPasswordSchema = z.object({ password });
export type SetPasswordRequest = z.infer<typeof setPasswordSchema>;

export interface MailboxResponse {
  readonly id: string;
  readonly domainId: string;
  readonly address: string;
  readonly localPart: string;
  readonly quotaMb: number;
  readonly active: boolean;
  readonly createdAt: string;
  // An address on a domain the platform owns, so the panel hides DNS and domain controls.
  readonly platform: boolean;
  // False while the domain is unverified: the views keep it out of Dovecot until then, and
  // the panel needs to say so rather than let someone debug an impossible login.
  readonly deliverable: boolean;
}
