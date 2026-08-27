import { z } from 'zod';

import { SENT_MESSAGE_STATUSES } from '../database/schema';

const address = z.string().trim().toLowerCase().min(3).max(320);

export const mailReceivedSchema = z.object({
  mailbox: address,
  messageId: z.string().trim().min(1).max(998),
  sender: address,
  subject: z.string().max(2000).nullable().default(null),
  folder: z.string().trim().min(1).max(255).default('INBOX'),
  imapUid: z.coerce.number().int().positive().nullable().default(null),
  spamScore: z.coerce.number().int().nullable().default(null),
  inReplyTo: z
    .string()
    .trim()
    .max(998)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
});
export type MailReceivedRequest = z.infer<typeof mailReceivedSchema>;

export const mailSentSchema = z.object({
  mailbox: address,
  messageId: z.string().trim().min(1).max(998),
  recipient: address,
  subject: z.string().max(2000).nullable().default(null),
  status: z.enum(SENT_MESSAGE_STATUSES).default('pending'),
  smtpResponseCode: z.string().trim().max(32).nullable().default(null),
});
export type MailSentRequest = z.infer<typeof mailSentSchema>;
