import { z } from 'zod';

const password = z.string().min(12).max(200);

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
  readonly platform: boolean;
  readonly deliverable: boolean;
}
