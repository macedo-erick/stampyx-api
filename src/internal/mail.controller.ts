import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { and, eq, sql } from 'drizzle-orm';
import type { Counter } from 'prom-client';

import { DATABASE, type Database } from '../database/db';
import { domain, mailbox, receivedMessage, sentMessage } from '../database/schema';
import { MESSAGES_RECEIVED } from '../metrics/metrics.module';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type MailReceivedRequest,
  type MailSentRequest,
  mailReceivedSchema,
  mailSentSchema,
} from './dto';
import { InternalSecretGuard } from './internal-secret.guard';
import { MailGateway } from './mail.gateway';

@Controller('internal/mail')
@UseGuards(InternalSecretGuard)
export class MailController {
  private readonly logger = new Logger(MailController.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly gateway: MailGateway,
    @InjectMetric(MESSAGES_RECEIVED) private readonly received: Counter,
  ) {}

  @Post('received')
  @HttpCode(202)
  async mailReceived(
    @Body(zodBody(mailReceivedSchema)) body: MailReceivedRequest,
  ): Promise<{ status: string }> {
    const target = await this.resolveMailbox(body.mailbox);

    // A reply inherits its parent's conversation; anything else starts one of its own. The
    // root is kept on the row so grouping is one predicate rather than a header walk.
    const threadId =
      body.inReplyTo === null
        ? body.messageId
        : ((await this.threadOf(target, body.inReplyTo)) ?? body.inReplyTo);

    // Sieve runs before delivery is confirmed, so a retried delivery replays this call.
    const inserted = await this.db
      .insert(receivedMessage)
      .values({
        id: randomUUID(),
        mailboxId: target,
        messageId: body.messageId,
        imapUid: body.imapUid,
        sender: body.sender,
        subject: body.subject,
        folder: body.folder,
        spamScore: body.spamScore,
        inReplyTo: body.inReplyTo,
        threadId,
      })
      .onConflictDoNothing({
        target: [receivedMessage.mailboxId, receivedMessage.folder, receivedMessage.messageId],
      })
      .returning();

    const row = inserted[0];

    if (row === undefined) {
      return { status: 'already-recorded' };
    }

    this.received.inc({ folder: row.folder });
    this.gateway.emitReceived({
      id: row.id,
      mailboxId: row.mailboxId,
      messageId: row.messageId,
      sender: row.sender,
      subject: row.subject,
      folder: row.folder,
      receivedAt: row.receivedAt.toISOString(),
    });

    this.logger.log({ event: 'message.received', mailboxId: target, folder: row.folder });

    return { status: 'recorded' };
  }

  @Post('sent')
  @HttpCode(202)
  async mailSent(
    @Body(zodBody(mailSentSchema)) body: MailSentRequest,
  ): Promise<{ status: string }> {
    const target = await this.resolveMailbox(body.mailbox);

    // The milter reports the same message again as its status moves pending to delivered
    // or bounced, so this upserts on the natural key rather than inserting twice.
    await this.db
      .insert(sentMessage)
      .values({
        id: randomUUID(),
        mailboxId: target,
        messageId: body.messageId,
        recipient: body.recipient,
        subject: body.subject,
        status: body.status,
        smtpResponseCode: body.smtpResponseCode,
      })
      .onConflictDoUpdate({
        target: [sentMessage.mailboxId, sentMessage.messageId, sentMessage.recipient],
        set: {
          status: sql`excluded.status`,
          smtpResponseCode: sql`excluded.smtp_response_code`,
        },
      });

    return { status: 'recorded' };
  }

  private async resolveMailbox(address: string): Promise<string> {
    const at = address.lastIndexOf('@');

    if (at < 1) {
      throw new NotFoundException('No such mailbox');
    }

    const localPart = address.slice(0, at);
    const domainName = address.slice(at + 1);

    const [row] = await this.db
      .select({ id: mailbox.id })
      .from(mailbox)
      .innerJoin(domain, eq(domain.id, mailbox.domainId))
      .where(sql`${mailbox.localPart} = ${localPart} AND ${domain.name} = ${domainName}`)
      .limit(1);

    if (row === undefined) {
      throw new NotFoundException('No such mailbox');
    }

    return row.id;
  }
  private async threadOf(mailboxId: string, parentMessageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ threadId: receivedMessage.threadId })
      .from(receivedMessage)
      .where(
        and(
          eq(receivedMessage.mailboxId, mailboxId),
          eq(receivedMessage.messageId, parentMessageId),
        ),
      )
      .limit(1);

    return row?.threadId ?? null;
  }
}
