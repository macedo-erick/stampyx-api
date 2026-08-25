import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start();

  project.provide('databaseUrl', container.getConnectionUri());

  return async (): Promise<void> => {
    await container.stop();
  };
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
