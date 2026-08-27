import { z } from 'zod';

const address = z.string().trim().toLowerCase().min(3).max(320).includes('@');

export const listMessagesSchema = z.object({
  folder: z.string().trim().min(1).max(255).default('INBOX'),
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListMessagesQuery = z.infer<typeof listMessagesSchema>;

export const sendMessageSchema = z.object({
  to: z.array(address).min(1).max(50),
  cc: z.array(address).max(50).default([]),
  bcc: z.array(address).max(50).default([]),
  subject: z.string().trim().max(2000).default(''),
  text: z.string().max(1_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  inReplyTo: z.string().trim().max(998).optional(),
  attachmentIds: z.array(z.uuid()).max(20).default([]),
  replacesDraftId: z.uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

export const saveDraftSchema = sendMessageSchema.extend({
  to: z.array(address).max(50).default([]),
});
export type SaveDraftRequest = z.infer<typeof saveDraftSchema>;

export const moveMessageSchema = z.object({
  folder: z.string().trim().min(1).max(255),
});
export type MoveMessageRequest = z.infer<typeof moveMessageSchema>;

export const setReadSchema = z.object({ read: z.boolean() });
export type SetReadRequest = z.infer<typeof setReadSchema>;

export interface MessageSummary {
  readonly id: string;
  readonly messageId: string;
  readonly sender: string;
  readonly recipient: string | null;
  readonly threadId: string | null;
  readonly subject: string | null;
  readonly folder: string;
  readonly receivedAt: string;
  readonly read: boolean;
  readonly spamScore: number | null;
}

export interface MessageDetail extends MessageSummary {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly html: string | null;
  readonly text: string | null;
  readonly attachments: readonly { filename: string; contentType: string; size: number }[];
}
