import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  close(): Promise<void>;
}

export const DATABASE = Symbol('STAMPYX_DATABASE');

export function createDatabase(
  url: string,
  options: { max?: number; quiet?: boolean } = {},
): DatabaseHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    ...(options.quiet === true ? { onnotice: (): void => undefined } : {}),
    types: {},
  });

  const db = drizzle(client, { schema });

  return {
    db,
    close: async (): Promise<void> => {
      await client.end();
    },
  };
}
