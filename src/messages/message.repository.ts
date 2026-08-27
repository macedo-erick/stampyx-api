import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type ReceivedMessage, receivedMessage, sentMessage } from '../database/schema';

@Injectable()
export class MessageRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listFolder(
    mailboxId: string,
    folder: string,
    page: number,
    size: number,
  ): Promise<{ rows: ReceivedMessage[]; total: number }> {
    const where = and(eq(receivedMessage.mailboxId, mailboxId), eq(receivedMessage.folder, folder));

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(receivedMessage)
        .where(where)
        .orderBy(desc(receivedMessage.receivedAt))
        .limit(size)
        .offset(page * size),
      this.db.select({ value: count() }).from(receivedMessage).where(where),
    ]);

    return { rows, total: totals?.value ?? 0 };
  }

  async findOwned(mailboxId: string, id: string): Promise<ReceivedMessage | null> {
    const [row] = await this.db
      .select()
      .from(receivedMessage)
      .where(and(eq(receivedMessage.id, id), eq(receivedMessage.mailboxId, mailboxId)))
      .limit(1);

    return row ?? null;
  }

  async update(id: string, values: Partial<typeof receivedMessage.$inferInsert>): Promise<void> {
    await this.db.update(receivedMessage).set(values).where(eq(receivedMessage.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(receivedMessage).where(eq(receivedMessage.id, id));
  }
  // The schema expects a milter that this stack does not have, so the send path records what it
  // handed over. Status stays `pending`: acceptance by Postfix is not delivery.
  async setImapUid(id: string, imapUid: number): Promise<void> {
    await this.db.update(receivedMessage).set({ imapUid }).where(eq(receivedMessage.id, id));
  }

  async recordSent(
    rows: {
      id: string;
      mailboxId: string;
      messageId: string;
      recipient: string;
      subject: string;
    }[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.db
      .insert(sentMessage)
      .values(rows)
      .onConflictDoNothing({
        target: [sentMessage.mailboxId, sentMessage.messageId, sentMessage.recipient],
      });
  }
  // Sent and Drafts are appended, so nothing reports them: listing mirrors the folder first,
  // which is what gives those messages a row and a UUID the panel can address.
  async syncFolder(
    mailboxId: string,
    folder: string,
    rows: readonly (typeof receivedMessage.$inferInsert)[],
  ): Promise<void> {
    if (rows.length > 0) {
      await this.db
        .insert(receivedMessage)
        .values([...rows])
        .onConflictDoUpdate({
          target: [receivedMessage.mailboxId, receivedMessage.folder, receivedMessage.messageId],
          set: {
            folder: sql`excluded.folder`,
            imapUid: sql`excluded.imap_uid`,
            read: sql`excluded.read`,
            recipient: sql`excluded.recipient`,
            subject: sql`excluded.subject`,
            inReplyTo: sql`excluded.in_reply_to`,
            // Self-healing: rows mirrored before the root existed carry themselves, and re-listing fixes them.
            threadId: sql`excluded.thread_id`,
          },
        });
    }

    // A superseded draft, or one removed elsewhere, leaves a row showing a message that is gone.
    const keep = rows.map((row) => row.messageId);

    await this.db
      .delete(receivedMessage)
      .where(
        and(
          eq(receivedMessage.mailboxId, mailboxId),
          eq(receivedMessage.folder, folder),
          keep.length === 0 ? sql`true` : notInArray(receivedMessage.messageId, keep),
        ),
      );
  }

  // The threads a batch of parents belong to, so replies inherit the root without a query each.
  async threadsOf(mailboxId: string, messageIds: readonly string[]): Promise<Map<string, string>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectDistinct({ messageId: receivedMessage.messageId, threadId: receivedMessage.threadId })
      .from(receivedMessage)
      .where(
        and(
          eq(receivedMessage.mailboxId, mailboxId),
          inArray(receivedMessage.messageId, [...new Set(messageIds)]),
        ),
      );

    return new Map(
      rows
        .filter((row): row is { messageId: string; threadId: string } => row.threadId !== null)
        .map((row) => [row.messageId, row.threadId] as const),
    );
  }

  // The conversation the parent belongs to, so a reply inherits the same root.
  async threadOf(mailboxId: string, messageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ threadId: receivedMessage.threadId })
      .from(receivedMessage)
      .where(
        and(eq(receivedMessage.mailboxId, mailboxId), eq(receivedMessage.messageId, messageId)),
      )
      .limit(1);

    return row?.threadId ?? null;
  }

  async listThread(mailboxId: string, threadId: string): Promise<ReceivedMessage[]> {
    return this.db
      .select()
      .from(receivedMessage)
      .where(and(eq(receivedMessage.mailboxId, mailboxId), eq(receivedMessage.threadId, threadId)))
      .orderBy(receivedMessage.receivedAt);
  }
}
