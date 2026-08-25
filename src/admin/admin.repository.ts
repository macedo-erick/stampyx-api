import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { account, domain, mailbox } from '../database/schema';

// The one module that does not filter by accountId, because listing every tenant is the
// point. Nothing outside admin/ may query this way - see AGENTS.md.
@Injectable()
export class AdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listAccounts() {
    return this.db
      .select({
        id: account.id,
        email: account.email,
        name: account.name,
        plan: account.plan,
        status: account.status,
        createdAt: account.createdAt,
        // count(distinct ...) because the two left joins multiply each other's rows.
        domainCount: sql<number>`count(distinct ${domain.id})::int`,
        mailboxCount: sql<number>`count(distinct ${mailbox.id})::int`,
      })
      .from(account)
      .leftJoin(domain, eq(domain.accountId, account.id))
      .leftJoin(mailbox, eq(mailbox.accountId, account.id))
      .groupBy(account.id)
      .orderBy(desc(account.createdAt));
  }

  async listDomains() {
    return this.db
      .select({
        id: domain.id,
        name: domain.name,
        kind: domain.kind,
        accountId: domain.accountId,
        accountEmail: account.email,
        verifiedAt: domain.verifiedAt,
        active: domain.active,
        createdAt: domain.createdAt,
      })
      .from(domain)
      .leftJoin(account, eq(account.id, domain.accountId))
      .orderBy(domain.name);
  }

  async listMailboxes() {
    return this.db
      .select({
        id: mailbox.id,
        localPart: mailbox.localPart,
        domainName: domain.name,
        domainKind: domain.kind,
        accountId: mailbox.accountId,
        accountEmail: account.email,
        quotaMb: mailbox.quotaMb,
        active: mailbox.active,
        lockedUntil: mailbox.lockedUntil,
        createdAt: mailbox.createdAt,
      })
      .from(mailbox)
      .innerJoin(domain, eq(domain.id, mailbox.domainId))
      .innerJoin(account, eq(account.id, mailbox.accountId))
      .orderBy(domain.name, mailbox.localPart);
  }

  async deleteAccount(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(account)
      .where(eq(account.id, id))
      .returning({ id: account.id });

    return deleted.length > 0;
  }

  async findMailbox(id: string) {
    const [row] = await this.db.select().from(mailbox).where(eq(mailbox.id, id)).limit(1);

    return row ?? null;
  }

  async deleteMailbox(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(mailbox)
      .where(eq(mailbox.id, id))
      .returning({ id: mailbox.id });

    return deleted.length > 0;
  }
}
