import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, max } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type FolderRule, folderRule, receivedMessage } from '../database/schema';

@Injectable()
export class RuleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listFor(mailboxId: string): Promise<FolderRule[]> {
    return this.db
      .select()
      .from(folderRule)
      .where(eq(folderRule.mailboxId, mailboxId))
      .orderBy(folderRule.position);
  }

  async findOwned(mailboxId: string, id: string): Promise<FolderRule | null> {
    const [row] = await this.db
      .select()
      .from(folderRule)
      .where(and(eq(folderRule.id, id), eq(folderRule.mailboxId, mailboxId)))
      .limit(1);

    return row ?? null;
  }

  async nextPosition(mailboxId: string): Promise<number> {
    const [row] = await this.db
      .select({ highest: max(folderRule.position) })
      .from(folderRule)
      .where(eq(folderRule.mailboxId, mailboxId));

    return (row?.highest ?? 0) + 1;
  }

  async insert(row: typeof folderRule.$inferInsert): Promise<FolderRule> {
    const [created] = await this.db.insert(folderRule).values(row).returning();

    if (created === undefined) {
      throw new Error('Insert returned no row');
    }

    return created;
  }

  async update(
    mailboxId: string,
    id: string,
    values: Partial<typeof folderRule.$inferInsert>,
  ): Promise<FolderRule | null> {
    const [row] = await this.db
      .update(folderRule)
      .set(values)
      .where(and(eq(folderRule.id, id), eq(folderRule.mailboxId, mailboxId)))
      .returning();

    return row ?? null;
  }

  async delete(mailboxId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(folderRule)
      .where(and(eq(folderRule.id, id), eq(folderRule.mailboxId, mailboxId)))
      .returning({ id: folderRule.id });

    return deleted.length > 0;
  }

  // Two passes in one transaction: shifting one at a time collides with the rows not yet moved.
  async reorder(mailboxId: string, ruleIds: readonly string[]): Promise<FolderRule[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(folderRule)
        .set({ position: 0 })
        .where(and(eq(folderRule.mailboxId, mailboxId), inArray(folderRule.id, [...ruleIds])));

      for (const [index, id] of ruleIds.entries()) {
        await tx
          .update(folderRule)
          .set({ position: index + 1 })
          .where(and(eq(folderRule.id, id), eq(folderRule.mailboxId, mailboxId)));
      }

      return tx
        .select()
        .from(folderRule)
        .where(eq(folderRule.mailboxId, mailboxId))
        .orderBy(folderRule.position);
    });
  }
  async previewCount(mailboxId: string, column: 'sender' | 'subject', pattern: string) {
    const target = column === 'sender' ? receivedMessage.sender : receivedMessage.subject;

    const [row] = await this.db
      .select({ total: count() })
      .from(receivedMessage)
      .where(and(eq(receivedMessage.mailboxId, mailboxId), ilike(target, pattern)));

    return row?.total ?? 0;
  }

  async previewSample(mailboxId: string, column: 'sender' | 'subject', pattern: string) {
    const target = column === 'sender' ? receivedMessage.sender : receivedMessage.subject;

    return this.db
      .select({
        id: receivedMessage.id,
        sender: receivedMessage.sender,
        subject: receivedMessage.subject,
        receivedAt: receivedMessage.receivedAt,
      })
      .from(receivedMessage)
      .where(and(eq(receivedMessage.mailboxId, mailboxId), ilike(target, pattern)))
      .orderBy(desc(receivedMessage.receivedAt))
      .limit(3);
  }
}
