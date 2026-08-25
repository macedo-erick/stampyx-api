import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type Attachment, attachment } from '../database/schema';

@Injectable()
export class AttachmentRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(row: typeof attachment.$inferInsert): Promise<Attachment> {
    const [created] = await this.db.insert(attachment).values(row).returning();

    if (created === undefined) {
      throw new Error('Insert returned no row');
    }

    return created;
  }

  // Drafts only: an attachment already tied to a sent message must not be re-sent or deleted.
  async findDrafts(mailboxId: string, ids: readonly string[]): Promise<Attachment[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.db
      .select()
      .from(attachment)
      .where(
        and(
          eq(attachment.mailboxId, mailboxId),
          isNull(attachment.messageId),
          inArray(attachment.id, [...ids]),
        ),
      );
  }

  async listDrafts(mailboxId: string): Promise<Attachment[]> {
    return this.db
      .select()
      .from(attachment)
      .where(and(eq(attachment.mailboxId, mailboxId), isNull(attachment.messageId)))
      .orderBy(attachment.createdAt);
  }

  async findDraft(mailboxId: string, id: string): Promise<Attachment | null> {
    const [row] = await this.findDrafts(mailboxId, [id]);

    return row ?? null;
  }

  async listForMessage(mailboxId: string, messageId: string): Promise<Attachment[]> {
    return this.db
      .select()
      .from(attachment)
      .where(and(eq(attachment.mailboxId, mailboxId), eq(attachment.messageId, messageId)));
  }

  async attachTo(ids: readonly string[], messageId: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db
      .update(attachment)
      .set({ messageId })
      .where(inArray(attachment.id, [...ids]));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(attachment).where(eq(attachment.id, id));
  }

  // Drafts nobody sent. The composer can be closed without a trace, so the rows and their
  // files would otherwise accumulate forever.
  async findStaleDrafts(before: Date): Promise<Attachment[]> {
    return this.db
      .select()
      .from(attachment)
      .where(and(isNull(attachment.messageId), lt(attachment.createdAt, before)));
  }
}
