import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type Alias, alias } from '../database/schema';

@Injectable()
export class AliasRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listForDestination(destination: string): Promise<Alias[]> {
    return this.db
      .select()
      .from(alias)
      .where(eq(alias.destination, destination))
      .orderBy(alias.source);
  }
}
