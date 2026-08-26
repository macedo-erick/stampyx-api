import { randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { Counter } from 'prom-client';

import { CONFIG, type Config } from '../config';
import type { PageResponse } from '../common/page-response';
import { pageOf } from '../common/page-response';
import type { ReceivedMessage } from '../database/schema';
import type { Attachment } from '../database/schema';
import type { OwnedMailbox } from '../mailboxes/mailbox.repository';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import { AttachmentService } from '../attachments/attachment.service';
import { MESSAGES_SENT } from '../metrics/metrics.module';
import { WarmupService } from '../warmup/warmup.service';
import type {
  ListMessagesQuery,
  MessageDetail,
  MessageSummary,
  SaveDraftRequest,
  SendMessageRequest,
} from './dto';
import type { FetchedAttachment, ImapMessage, ParsedBody } from './imap.client';
import { ImapClient } from './imap.client';
import { MessageRepository } from './message.repository';
import { sanitizeMessageHtml } from './sanitize';

// Past this, a thread is an archive rather than a conversation: the newest carry bodies and
// the rest stay listed.
const THREAD_BODY_LIMIT = 25;

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: MessageRepository,
    private readonly mailboxes: MailboxRepository,
    private readonly imap: ImapClient,
    private readonly attachments: AttachmentService,
    private readonly warmup: WarmupService,
    @InjectMetric(MESSAGES_SENT) private readonly sent: Counter,
  ) {}

  async list(
    accountId: string,
    mailboxId: string,
    query: ListMessagesQuery,
  ): Promise<PageResponse<MessageSummary>> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);

    // The projection is a mirror, not a second source of truth. Sent and Drafts are never
    // reported at all (they are appended, not delivered), and any folder drifts the moment
    // another client moves or deletes something. Reconciling against IMAP on the way in is
    // what stopped the panel from showing a folder as empty while the server had mail in it.
    await this.syncFolder(mailbox, mailboxId, query.folder);

    const { rows, total } = await this.repository.listFolder(
      mailboxId,
      query.folder,
      query.page,
      query.size,
    );

    return pageOf(rows.map(toSummary), query.page, query.size, total);
  }

  async read(accountId: string, mailboxId: string, id: string): Promise<MessageDetail> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);

    const row = await this.requireMessage(mailboxId, id);

    const uid = await this.resolveUid(mailbox, row);
    const body = uid === null ? null : await this.imap.fetchBody(address(mailbox), row.folder, uid);

    if (!row.read) {
      await this.markRead(accountId, mailboxId, id, true);
    }

    return toDetail({ ...row, read: true }, body);
  }

  async markRead(accountId: string, mailboxId: string, id: string, read: boolean): Promise<void> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const row = await this.requireMessage(mailboxId, id);

    // IMAP first: if it fails, Postgres must not claim a state the mail server disagrees with.
    if (row.imapUid !== null) {
      await this.imap.setSeen(address(mailbox), row.folder, row.imapUid, read);
    }

    await this.repository.update(id, { read });
  }

  async move(accountId: string, mailboxId: string, id: string, folder: string): Promise<void> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const row = await this.requireMessage(mailboxId, id);

    const uid = await this.resolveUid(mailbox, row);

    if (uid !== null) {
      await this.imap.move(address(mailbox), row.folder, uid, folder);
    }

    // The row goes rather than moves. Carrying it over collided with the copy the target
    // folder may already hold - the same Message-ID is genuinely in Sent and in INBOX - and
    // the unique key rejected it. The mirror puts it back when the target is next listed.
    await this.repository.delete(id);
    this.logger.log({ event: 'message.moved', messageId: id, folder });
  }

  // Delete means Trash, the way every mail client behaves. Only a message already in Trash
  // is expunged. The old path called messageDelete straight away, which was permanent - and
  // it skipped IMAP entirely whenever imapUid was null, which it always was.
  async remove(accountId: string, mailboxId: string, id: string): Promise<void> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const row = await this.requireMessage(mailboxId, id);
    const uid = await this.resolveUid(mailbox, row);
    const trash = await this.specialFolder(mailbox, '\\Trash');

    if (trash !== null && row.folder !== trash) {
      if (uid !== null) {
        await this.imap.move(address(mailbox), row.folder, uid, trash);
      }

      // Dropped rather than re-filed, for the same reason a move does it: Trash may already
      // hold a copy of this exact Message-ID, and two of them cannot share the key.
      await this.repository.delete(id);
      this.logger.log({ event: 'message.trashed', messageId: id });

      return;
    }

    if (uid !== null) {
      await this.imap.remove(address(mailbox), row.folder, uid);
    }

    await this.repository.delete(id);
    this.logger.log({ event: 'message.deleted', messageId: id });
  }

  async send(
    accountId: string,
    mailboxId: string,
    input: SendMessageRequest,
  ): Promise<{ messageId: string }> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);

    if (mailbox.domainVerifiedAt === null) {
      throw new ForbiddenException('This domain is not verified yet, so it cannot send');
    }

    // Resolved before the allowance is spent: an unknown attachment id should not cost the
    // caller one of their daily sends.
    const attached = await this.attachments.claim(mailboxId, input.attachmentIds);

    // Consumed before handing anything to the MTA, so a refused send never leaves the box.
    await this.warmup.consumeAllowance(accountId);

    const from = address(mailbox);
    const messageId = `<${randomUUID()}@${mailbox.domainName}>`;
    const recipients = [...input.to, ...input.cc, ...input.bcc];

    const transport = createTransport({
      host: this.config.MAIL_SMTP_HOST,
      port: this.config.MAIL_SMTP_PORT,
      secure: this.config.MAIL_SMTP_PORT === 465,
      auth: {
        user: `${from}*${this.config.MAIL_MASTER_USER}`,
        pass: this.config.MAIL_MASTER_PASSWORD,
      },
    });

    // Composed once and reused: the copy filed in Sent is byte-for-byte what left, rather
    // than a second rendering that could differ.
    const raw = await this.compose(mailbox, messageId, input, attached);

    try {
      await transport.sendMail({ envelope: { from, to: recipients }, raw });
    } catch (error) {
      // The MTA being unreachable is an operational fact, not a bug in the request, and a
      // bare 500 sends whoever is on call reading application logs for a connection refused.
      if (isUnreachable(error)) {
        const where = `${this.config.MAIL_SMTP_HOST}:${String(this.config.MAIL_SMTP_PORT)}`;

        this.logger.error({ event: 'message.transport_unreachable', mailboxId, target: where });

        throw new ServiceUnavailableException(
          `The mail server at ${where} is not reachable, so nothing was sent.`,
        );
      }

      throw error;
    } finally {
      transport.close();
    }

    // Bound only now: until the MTA accepted it, there was no Message-ID to bind them to.
    await this.attachments.attachTo(
      attached.map((row) => row.id),
      messageId,
    );

    // Neither of these is done by the mail plane: Postfix relays but files no copy, and the
    // milter the schema assumes does not exist in this stack.
    await this.fileInSent(mailbox, raw);
    await this.discardDraft(mailbox, mailboxId, input.replacesDraftId);
    await this.repository.recordSent(
      recipients.map((recipient) => ({
        id: randomUUID(),
        mailboxId,
        messageId,
        recipient,
        subject: input.subject,
      })),
    );

    this.sent.inc({ attachments: attached.length === 0 ? 'false' : 'true' });
    this.logger.log({ event: 'message.sent', mailboxId, messageId });

    return { messageId };
  }

  private async compose(
    mailbox: OwnedMailbox,
    messageId: string,
    input: SendMessageRequest | SaveDraftRequest,
    attached: readonly Attachment[],
  ): Promise<Buffer> {
    return new MailComposer({
      messageId,
      from: address(mailbox),
      to: input.to,
      cc: input.cc,
      ...(input.bcc.length === 0 ? {} : { bcc: input.bcc }),
      subject: input.subject,
      text: input.text,
      ...(input.html === undefined ? {} : { html: input.html }),
      ...(input.inReplyTo === undefined
        ? {}
        : { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }),
      ...(attached.length === 0
        ? {}
        : {
            attachments: attached.map((row) => ({
              filename: row.fileName,
              path: row.storagePath,
              contentType: row.mimeType,
            })),
          }),
    })
      .compile()
      .build();
  }

  async saveDraft(accountId: string, mailboxId: string, input: SaveDraftRequest): Promise<void> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const attached = await this.attachments.claim(mailboxId, input.attachmentIds);
    const messageId = `<${randomUUID()}@${mailbox.domainName}>`;
    const raw = await this.compose(mailbox, messageId, input, attached);
    const drafts = (await this.specialFolder(mailbox, '\\Drafts')) ?? 'Drafts';

    // \Draft marks it as unfinished so a mail client offers to edit rather than to read.
    await this.imap.append(address(mailbox), drafts, raw, ['\\Draft', '\\Seen']);
    await this.discardDraft(mailbox, mailboxId, input.replacesDraftId);
    await this.attachments.attachTo(
      attached.map((row) => row.id),
      messageId,
    );

    this.logger.log({ event: 'message.draft_saved', mailboxId, messageId });
  }

  // A draft that was sent, or superseded by a newer save, has no reason to stay. Best
  // effort: whatever it produced is already out, so a stuck draft must not fail the call.
  private async discardDraft(
    mailbox: OwnedMailbox,
    mailboxId: string,
    draftId: string | undefined,
  ): Promise<void> {
    if (draftId === undefined) {
      return;
    }

    try {
      const located = await this.locate(mailbox, mailboxId, draftId);

      await this.imap.remove(address(mailbox), located.folder, located.uid);
      await this.repository.delete(draftId);
    } catch (error) {
      this.logger.warn({
        event: 'message.draft_discard_failed',
        mailboxId: mailbox.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Resolved the same way a body is, so it works for a delivered message and for one that
  // only exists in IMAP.
  async readAttachment(
    accountId: string,
    mailboxId: string,
    id: string,
    index: number,
  ): Promise<FetchedAttachment> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const located = await this.locate(mailbox, mailboxId, id);
    const found = await this.imap.fetchAttachment(
      address(mailbox),
      located.folder,
      located.uid,
      index,
    );

    if (found === null) {
      throw new NotFoundException('No such attachment');
    }

    return found;
  }

  private async locate(
    mailbox: OwnedMailbox,
    mailboxId: string,
    id: string,
  ): Promise<{ folder: string; uid: number }> {
    const row = await this.requireMessage(mailboxId, id);
    const uid = await this.resolveUid(mailbox, row);

    if (uid === null) {
      throw new NotFoundException('No such message');
    }

    return { folder: row.folder, uid };
  }

  // The whole conversation, oldest first, bodies included - this is what the reading pane
  // opens with. It replaces the read + thread pair the panel used to fire on every click:
  // one request now returns the message and everything it belongs to.
  async thread(accountId: string, mailboxId: string, id: string): Promise<MessageDetail[]> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const row = await this.requireMessage(mailboxId, id);

    const siblings =
      row.threadId === null ? [] : await this.repository.listThread(mailboxId, row.threadId);
    const rows = dedupeThread(
      siblings.some((entry) => entry.id === row.id) ? siblings : [row],
      row,
    );

    if (!row.read) {
      await this.markRead(accountId, mailboxId, id, true);
    }

    // A conversation nobody will scroll to the end of is not worth the fetches. The newest
    // are the ones a reader opens for; anything older is still listed, just without a body.
    const withBody = new Set(rows.slice(-THREAD_BODY_LIMIT).map((entry) => entry.id));
    const bodies = await this.fetchThreadBodies(
      mailbox,
      rows.filter((entry) => withBody.has(entry.id)),
    );

    return rows.map((entry) =>
      toDetail(
        entry.id === row.id ? { ...entry, read: true } : entry,
        bodies.get(entry.id) ?? null,
      ),
    );
  }

  // One IMAP connection per folder rather than one per message: a reply and its original
  // usually sit in Sent and INBOX, so a three-message thread is two connections, not three.
  private async fetchThreadBodies(
    mailbox: OwnedMailbox,
    rows: readonly ReceivedMessage[],
  ): Promise<Map<string, ParsedBody>> {
    const located = await Promise.all(
      rows.map(async (row) => ({ row, uid: await this.resolveUid(mailbox, row) })),
    );

    const byFolder = new Map<string, { id: string; uid: number }[]>();

    for (const { row, uid } of located) {
      if (uid !== null) {
        byFolder.set(row.folder, [...(byFolder.get(row.folder) ?? []), { id: row.id, uid }]);
      }
    }

    const bodies = new Map<string, ParsedBody>();

    for (const [folder, entries] of byFolder) {
      try {
        const fetched = await this.imap.fetchBodies(
          address(mailbox),
          folder,
          entries.map((entry) => entry.uid),
        );

        for (const entry of entries) {
          const body = fetched.get(entry.uid);

          if (body !== undefined) {
            bodies.set(entry.id, body);
          }
        }
      } catch (error) {
        // One unreadable folder must not cost the reader the rest of the conversation.
        this.logger.warn({
          event: 'message.thread_body_skipped',
          mailboxId: mailbox.id,
          folder,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return bodies;
  }

  private async syncFolder(
    mailbox: OwnedMailbox,
    mailboxId: string,
    folder: string,
  ): Promise<void> {
    let rows;

    try {
      rows = await this.imap.listMessages(address(mailbox), folder);
    } catch (error) {
      // A mirror that cannot read the source must not delete the copy: an IMAP hiccup would
      // otherwise empty the folder in the panel. Serve what is already known instead.
      this.logger.warn({
        event: 'message.sync_skipped',
        mailboxId,
        folder,
        reason: error instanceof Error ? error.message : String(error),
      });

      return;
    }

    // A message with no Message-ID cannot be keyed, and every client writes one.
    const usable = dedupe(rows.filter((row) => row.messageId !== ''));

    if (usable.length !== rows.length) {
      this.logger.debug({
        event: 'message.sync_deduped',
        mailboxId,
        folder,
        dropped: rows.length - usable.length,
      });
    }

    // Stamping every mirrored row as its own thread root is what flattened conversations:
    // a reply landing through the mirror lost the thread the notify pipe had derived. The
    // root is the parent's thread when the parent is known, and the parent's Message-ID
    // otherwise - which is the same value the parent will take when it is mirrored too.
    const parents = await this.repository.threadsOf(
      mailboxId,
      usable.map((row) => row.inReplyTo).filter((value): value is string => value !== null),
    );

    await this.repository.syncFolder(
      mailboxId,
      folder,
      usable.map((row) => ({
        id: randomUUID(),
        mailboxId,
        messageId: row.messageId,
        imapUid: row.uid,
        sender: row.from,
        recipient: row.to[0] ?? null,
        subject: row.subject,
        folder,
        receivedAt: new Date(row.date),
        read: row.seen,
        inReplyTo: row.inReplyTo,
        threadId:
          row.inReplyTo === null ? row.messageId : (parents.get(row.inReplyTo) ?? row.inReplyTo),
      })),
    );
  }

  private async specialFolder(mailbox: OwnedMailbox, use: string): Promise<string | null> {
    const folders = await this.imap.listFolders(address(mailbox));

    return folders.find((row) => row.specialUse === use)?.path ?? null;
  }

  // The row usually arrives without a UID, so it is looked up once by Message-ID and kept:
  // every later read of the same message goes straight to the fetch.
  private async resolveUid(mailbox: OwnedMailbox, row: ReceivedMessage): Promise<number | null> {
    if (row.imapUid !== null) {
      return row.imapUid;
    }

    const found = await this.imap.findUid(address(mailbox), row.folder, row.messageId);

    if (found !== null) {
      await this.repository.setImapUid(row.id, found);
    }

    return found;
  }

  // Best effort: the message did leave, so a failure to file the copy must not turn a
  // successful send into an error.
  private async fileInSent(mailbox: OwnedMailbox, raw: Buffer): Promise<void> {
    try {
      const folders = await this.imap.listFolders(address(mailbox));
      const sent = folders.find((row) => row.specialUse === '\\Sent');

      await this.imap.append(address(mailbox), sent?.path ?? 'Sent', raw, ['\\Seen']);
    } catch (error) {
      this.logger.warn({
        event: 'message.sent_copy_failed',
        mailboxId: mailbox.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requireMailbox(accountId: string, mailboxId: string): Promise<OwnedMailbox> {
    const mailbox = await this.mailboxes.findOwned(accountId, mailboxId);

    if (mailbox === null) {
      throw new NotFoundException('No such mailbox');
    }

    return mailbox;
  }

  private async requireMessage(mailboxId: string, id: string): Promise<ReceivedMessage> {
    const row = await this.repository.findOwned(mailboxId, id);

    if (row === null) {
      throw new NotFoundException('No such message');
    }

    return row;
  }
}

function address(mailbox: OwnedMailbox): string {
  return `${mailbox.localPart}@${mailbox.domainName}`;
}

function toSummary(row: ReceivedMessage): MessageSummary {
  return {
    id: row.id,
    messageId: row.messageId,
    sender: row.sender,
    recipient: row.recipient,
    threadId: row.threadId,
    subject: row.subject,
    folder: row.folder,
    receivedAt: row.receivedAt.toISOString(),
    read: row.read,
    spamScore: row.spamScore,
  };
}

// One message, two rows: mail you send to yourself is delivered to INBOX and filed in Sent
// under a single Message-ID, and the conversation listed both, so every self-addressed
// message appeared twice. The copy in the folder being read is the one that survives.
function dedupeThread(rows: readonly ReceivedMessage[], opened: ReceivedMessage): ReceivedMessage[] {
  const kept = new Map<string, ReceivedMessage>();

  for (const row of rows) {
    const seen = kept.get(row.messageId);

    if (seen === undefined || rank(row, opened) > rank(seen, opened)) {
      kept.set(row.messageId, row);
    }
  }

  return [...kept.values()];
}

function rank(row: ReceivedMessage, opened: ReceivedMessage): number {
  if (row.id === opened.id) {
    return 2;
  }

  return row.folder === opened.folder ? 1 : 0;
}

// The projection keys a message by its Message-ID within a folder, but IMAP does not: delete
// both copies of a message you sent yourself and Trash holds two rows with one Message-ID.
// Postgres refuses to touch the same key twice in one upsert, which took the whole listing
// down with a 500. The newest copy wins and the folder stays readable.
function dedupe(rows: readonly ImapMessage[]): ImapMessage[] {
  const byId = new Map<string, ImapMessage>();

  for (const row of rows) {
    const seen = byId.get(row.messageId);

    if (seen === undefined || row.uid > seen.uid) {
      byId.set(row.messageId, row);
    }
  }

  return [...byId.values()];
}

function toDetail(row: ReceivedMessage, body: ParsedBody | null): MessageDetail {
  return {
    ...toSummary(row),
    // The projection keeps the sender, never the recipients: the message itself is the only
    // place they exist, which is why reopening a draft needs its body read.
    to: body?.to ?? [],
    cc: body?.cc ?? [],
    html: body?.html == null ? null : sanitizeMessageHtml(body.html),
    text: body?.text ?? null,
    attachments: body?.attachments ?? [],
  };
}

const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
]);

function isUnreachable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' && UNREACHABLE.has(code);
}
