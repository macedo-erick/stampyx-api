import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, like, or, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { folderRule, receivedMessage } from '../database/schema';

export interface FolderCounts {
  readonly folder: string;
  readonly total: number;
  readonly unread: number;
}

@Injectable()
export class FolderRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async counts(mailboxId: string): Promise<FolderCounts[]> {
    const rows = await this.db
      .select({
        folder: receivedMessage.folder,
        total: count(),
        unread: sql<number>`count(*) FILTER (WHERE NOT ${receivedMessage.read})::int`,
      })
      .from(receivedMessage)
      .where(eq(receivedMessage.mailboxId, mailboxId))
      .groupBy(receivedMessage.folder);

    return rows.map((row) => ({ folder: row.folder, total: row.total, unread: row.unread }));
  }

  // Rules that would break if the folder went away: the Sieve script names it as a target.
  async ruleTargets(mailboxId: string): Promise<{ folder: string; total: number }[]> {
    const rows = await this.db
      .select({ folder: folderRule.targetFolder, total: count() })
      .from(folderRule)
      .where(and(eq(folderRule.mailboxId, mailboxId), eq(folderRule.action, 'move_to')))
      .groupBy(folderRule.targetFolder);

    return rows
      .filter((row): row is { folder: string; total: number } => row.folder !== null)
      .map((row) => ({ folder: row.folder, total: row.total }));
  }

  // The folder and everything under it, as IMAP does; the separator is the server's, so passed in.
  private subtree(mailboxId: string, path: string, delimiter: string) {
    return and(
      eq(receivedMessage.mailboxId, mailboxId),
      or(eq(receivedMessage.folder, path), like(receivedMessage.folder, `${path}${delimiter}%`)),
    );
  }

  async renameSubtree(
    mailboxId: string,
    path: string,
    target: string,
    delimiter: string,
  ): Promise<void> {
    await this.db
      .update(receivedMessage)
      .set({
        // Explicit casts: Postgres cannot infer a bare parameter beside ||, and the statement fails to plan.
        folder: sql`${target}::text || substring(${receivedMessage.folder} from ${path.length + 1}::int)`,
      })
      .where(this.subtree(mailboxId, path, delimiter));
  }

  // Dovecot already destroyed the messages, so any row left behind is a phantom in the list.
  async deleteSubtree(mailboxId: string, path: string, delimiter: string): Promise<void> {
    await this.db.delete(receivedMessage).where(this.subtree(mailboxId, path, delimiter));
  }
}
