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
  // Draft attachments already uploaded to this mailbox. The total size is checked again
  // here, because uploads happen one at a time.
  attachmentIds: z.array(z.uuid()).max(20).default([]),
  // The draft this supersedes, if the composer was opened from one. Saving again replaces
  // it rather than leaving a trail of half-written copies; sending removes it.
  replacesDraftId: z.uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

// A draft is unfinished by definition: half the time it is a subject and a paragraph with
// nobody in the To field yet. Requiring a recipient here made saving one impossible, which
// is exactly when a draft is worth keeping.
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
  // The RFC Message-ID, not the row id: threading a reply needs the one the sender wrote.
  readonly messageId: string;
  readonly sender: string;
  // Only set for a message this mailbox wrote, where a list shows who it went to.
  readonly recipient: string | null;
  // The first message of the conversation, so replies group under one root.
  readonly threadId: string | null;
  readonly subject: string | null;
  readonly folder: string;
  readonly receivedAt: string;
  readonly read: boolean;
  readonly spamScore: number | null;
}

export interface MessageDetail extends MessageSummary {
  // Only meaningful for a message this mailbox wrote: a draft reopens with these filled in.
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly html: string | null;
  readonly text: string | null;
  readonly attachments: readonly { filename: string; contentType: string; size: number }[];
}
