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
import type { ListMessagesQuery, MessageDetail, MessageSummary, SendMessageRequest } from './dto';
import type { FetchedAttachment } from './imap.client';
import { ImapClient } from './imap.client';
import { MessageRepository } from './message.repository';
import { sanitizeMessageHtml } from './sanitize';

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

    // Sent and Drafts are appended, never delivered, so nothing reports them. Mirroring the
    // folder into the projection first gives those messages a row - and a UUID - so every
    // folder is listed and addressed exactly the same way from here on.
    if (await this.isAppendOnly(mailbox, query.folder)) {
      await this.syncFolder(mailbox, mailboxId, query.folder);
    }

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

    return {
      ...toSummary({ ...row, read: true }),
      // received_message keeps the sender, not the recipients, so a delivered message has
      // nothing to put here.
      to: [],
      cc: [],
      html: body?.html == null ? null : sanitizeMessageHtml(body.html),
      text: body?.text ?? null,
      attachments: body?.attachments ?? [],
    };
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

    if (row.imapUid !== null) {
      await this.imap.move(address(mailbox), row.folder, row.imapUid, folder);
    }

    // The UID is only unique within a folder, so it is meaningless after a move until the
    // next delivery hook reports the new one.
    await this.repository.update(id, { folder, imapUid: null });
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

      // Moving does not go through delivery, so nothing else would update the projection.
      await this.repository.update(id, { folder: trash, imapUid: null });
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
    input: SendMessageRequest,
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

  async saveDraft(accountId: string, mailboxId: string, input: SendMessageRequest): Promise<void> {
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

  private async syncFolder(
    mailbox: OwnedMailbox,
    mailboxId: string,
    folder: string,
  ): Promise<void> {
    const rows = await this.imap.listMessages(address(mailbox), folder);

    await this.repository.syncFolder(
      mailboxId,
      folder,
      rows
        // A message with no Message-ID cannot be keyed, and every client writes one.
        .filter((row) => row.messageId !== '')
        .map((row) => ({
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
          threadId: row.messageId,
        })),
    );
  }

  private async specialFolder(mailbox: OwnedMailbox, use: string): Promise<string | null> {
    const folders = await this.imap.listFolders(address(mailbox));

    return folders.find((row) => row.specialUse === use)?.path ?? null;
  }

  private async isAppendOnly(mailbox: OwnedMailbox, folder: string): Promise<boolean> {
    const folders = await this.imap.listFolders(address(mailbox));
    const found = folders.find((row) => row.path === folder);

    return found?.specialUse === '\\Sent' || found?.specialUse === '\\Drafts';
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
