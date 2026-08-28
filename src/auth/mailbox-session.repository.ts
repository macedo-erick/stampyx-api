import { Inject, Injectable } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type MailboxSession, mailboxSession } from '../database/schema';

@Injectable()
export class MailboxSessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(row: typeof mailboxSession.$inferInsert): Promise<void> {
    await this.db.insert(mailboxSession).values(row);
  }

  async findByHash(hash: string): Promise<MailboxSession | null> {
    const [row] = await this.db
      .select()
      .from(mailboxSession)
      .where(eq(mailboxSession.refreshTokenHash, hash))
      .limit(1);

    return row ?? null;
  }

  async deleteByHash(hash: string): Promise<void> {
    await this.db.delete(mailboxSession).where(eq(mailboxSession.refreshTokenHash, hash));
  }

  async deleteForMailbox(mailboxId: string): Promise<void> {
    await this.db.delete(mailboxSession).where(eq(mailboxSession.mailboxId, mailboxId));
  }

  async deleteExpired(): Promise<void> {
    await this.db.delete(mailboxSession).where(lt(mailboxSession.expiresAt, new Date()));
  }
}
