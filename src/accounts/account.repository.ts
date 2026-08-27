import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type Account, account } from '../database/schema';

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findBySub(sub: string): Promise<Account | null> {
    const [row] = await this.db.select().from(account).where(eq(account.keycloakSub, sub)).limit(1);

    return row ?? null;
  }

  async findById(id: string): Promise<Account | null> {
    const [row] = await this.db.select().from(account).where(eq(account.id, id)).limit(1);

    return row ?? null;
  }

  async provision(input: {
    id: string;
    keycloakSub: string;
    email: string;
    name: string | null;
    status?: 'pending' | 'active';
  }): Promise<{ created: boolean }> {
    const inserted = await this.db
      .insert(account)
      .values({
        id: input.id,
        keycloakSub: input.keycloakSub,
        email: input.email,
        name: input.name,
        status: input.status ?? 'pending',
        ...(input.status === 'active' ? { approvedAt: new Date() } : {}),
      })
      .onConflictDoNothing({ target: account.keycloakSub })
      .returning({ id: account.id });

    return { created: inserted.length > 0 };
  }

  async setStatus(id: string, status: 'pending' | 'active' | 'suspended'): Promise<Account | null> {
    const [row] = await this.db
      .update(account)
      .set({ status, ...(status === 'active' ? { approvedAt: new Date() } : {}) })
      .where(eq(account.id, id))
      .returning();

    return row ?? null;
  }
}
