import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type Mailbox, account, domain, mailbox } from '../database/schema';

export interface OwnedMailbox extends Mailbox {
  readonly domainName: string;
  readonly domainKind: string;
  readonly domainVerifiedAt: Date | null;
}

// What PrincipalGuard needs to judge a mailbox session, mirroring v_dovecot_users: what the
// mail server would refuse, the panel refuses too.
export interface MailboxStanding extends OwnedMailbox {
  readonly domainActive: boolean;
  readonly accountStatus: string;
}

@Injectable()
export class MailboxRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listForDomain(accountId: string, domainId: string): Promise<OwnedMailbox[]> {
    return this.select()
      .where(and(eq(mailbox.domainId, domainId), eq(mailbox.accountId, accountId)))
      .orderBy(mailbox.localPart);
  }

  async listForAccount(accountId: string): Promise<OwnedMailbox[]> {
    return this.select().where(eq(mailbox.accountId, accountId)).orderBy(mailbox.localPart);
  }

  // Ownership is a join predicate, so someone else's row never comes back. It hangs off the
  // mailbox, not the domain: a platform mailbox belongs to someone who owns no domain.
  async findOwned(accountId: string, id: string): Promise<OwnedMailbox | null> {
    const [row] = await this.select()
      .where(and(eq(mailbox.id, id), eq(mailbox.accountId, accountId)))
      .limit(1);

    return row ?? null;
  }

  // The login lookup, so deliberately not account-scoped.
  async findByAddress(localPart: string, domainName: string): Promise<MailboxStanding | null> {
    const [row] = await this.selectStanding()
      .where(and(eq(mailbox.localPart, localPart), eq(domain.name, domainName)))
      .limit(1);

    return row ?? null;
  }

  async findStanding(id: string): Promise<MailboxStanding | null> {
    const [row] = await this.selectStanding().where(eq(mailbox.id, id)).limit(1);

    return row ?? null;
  }

  async existsAt(domainId: string, localPart: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(and(eq(mailbox.domainId, domainId), eq(mailbox.localPart, localPart)))
      .limit(1);

    return row !== undefined;
  }

  // Not account-scoped: the Sieve reconciler runs at boot for nobody. Nothing request-facing may use it.
  async listAllActive(): Promise<OwnedMailbox[]> {
    return this.select().where(eq(mailbox.active, true));
  }

  async insert(row: typeof mailbox.$inferInsert): Promise<Mailbox> {
    const [created] = await this.db.insert(mailbox).values(row).returning();

    if (created === undefined) {
      throw new Error('Insert returned no row');
    }

    return created;
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(mailbox)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null })
      .where(eq(mailbox.id, id));
  }

  async registerFailedLogin(id: string, maxAttempts: number, lockMs: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${mailbox}
      SET failed_login_count = failed_login_count + 1,
          locked_until = CASE
            WHEN failed_login_count + 1 >= ${maxAttempts}
            THEN now() + ${`${String(lockMs)} milliseconds`}::interval
            ELSE locked_until
          END
      WHERE id = ${id}
    `);
  }

  async clearFailedLogins(id: string): Promise<void> {
    await this.db
      .update(mailbox)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(mailbox.id, id));
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(mailbox)
      .where(eq(mailbox.id, id))
      .returning({ id: mailbox.id });

    return deleted.length > 0;
  }

  private select() {
    return this.db
      .select(this.columns())
      .from(mailbox)
      .innerJoin(domain, eq(domain.id, mailbox.domainId))
      .$dynamic();
  }

  private selectStanding() {
    return this.db
      .select({
        ...this.columns(),
        domainActive: domain.active,
        accountStatus: account.status,
      })
      .from(mailbox)
      .innerJoin(domain, eq(domain.id, mailbox.domainId))
      .innerJoin(account, eq(account.id, mailbox.accountId))
      .$dynamic();
  }

  private columns() {
    return {
      id: mailbox.id,
      domainId: mailbox.domainId,
      accountId: mailbox.accountId,
      localPart: mailbox.localPart,
      passwordHash: mailbox.passwordHash,
      quotaMb: mailbox.quotaMb,
      active: mailbox.active,
      failedLoginCount: mailbox.failedLoginCount,
      lockedUntil: mailbox.lockedUntil,
      createdAt: mailbox.createdAt,
      domainName: domain.name,
      domainKind: domain.kind,
      domainVerifiedAt: domain.verifiedAt,
    };
  }
}
