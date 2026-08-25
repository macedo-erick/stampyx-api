import { defineConfig } from 'drizzle-kit';

import { databaseUrl, loadConfig } from './src/config';

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl(loadConfig()) },
  strict: true,
  verbose: true,
});
