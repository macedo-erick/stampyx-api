import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type Domain, domain } from '../database/schema';

@Injectable()
export class DomainRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listFor(accountId: string): Promise<Domain[]> {
    return this.db
      .select()
      .from(domain)
      .where(eq(domain.accountId, accountId))
      .orderBy(domain.name);
  }

  // Owner is in the predicate, so someone else's row is indistinguishable from no row.
  async findOwned(accountId: string, id: string): Promise<Domain | null> {
    const [row] = await this.db
      .select()
      .from(domain)
      .where(and(eq(domain.id, id), eq(domain.accountId, accountId)))
      .limit(1);

    return row ?? null;
  }

  async listPlatform(): Promise<Domain[]> {
    return this.db.select().from(domain).where(eq(domain.kind, 'platform')).orderBy(domain.name);
  }

  async findPlatform(id: string): Promise<Domain | null> {
    const [row] = await this.db
      .select()
      .from(domain)
      .where(and(eq(domain.id, id), eq(domain.kind, 'platform')))
      .limit(1);

    return row ?? null;
  }

  async findByName(name: string): Promise<Domain | null> {
    const [row] = await this.db.select().from(domain).where(eq(domain.name, name)).limit(1);

    return row ?? null;
  }

  async insert(row: typeof domain.$inferInsert): Promise<Domain> {
    const [created] = await this.db.insert(domain).values(row).returning();

    if (created === undefined) {
      throw new Error('Insert returned no row');
    }

    return created;
  }

  async markVerified(accountId: string, id: string): Promise<Domain | null> {
    const [row] = await this.db
      .update(domain)
      .set({ verifiedAt: new Date() })
      .where(and(eq(domain.id, id), eq(domain.accountId, accountId)))
      .returning();

    return row ?? null;
  }

  async delete(accountId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(domain)
      .where(and(eq(domain.id, id), eq(domain.accountId, accountId)))
      .returning({ id: domain.id });

    return deleted.length > 0;
  }
}
