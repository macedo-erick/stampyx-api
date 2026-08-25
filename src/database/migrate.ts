import path from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { type Config, databaseUrl, loadConfig } from '../config';
import { createDatabase } from './db';

export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

export async function runMigrations(config: Config): Promise<void> {
  const handle = createDatabase(databaseUrl(config), { max: 1, quiet: true });

  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  await runMigrations(loadConfig());
  console.info('Migrations applied.');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
