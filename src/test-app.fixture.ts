import { randomUUID } from 'node:crypto';

import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Request } from 'express';
import { inject } from 'vitest';

import { AppModule } from './app.module';
import { JwtGuard } from './auth/jwt.guard';
import { CONFIG, type Config, loadConfig } from './config';
import { DATABASE, type Database, createDatabase } from './database/db';
import { MIGRATIONS_FOLDER } from './database/migrate';
import { account } from './database/schema';

// Stands in for JwtGuard, so it produces the same two identities the real one does. Standing
// is still decided by PrincipalGuard against real rows: nothing here shortcuts that.
export class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const mailboxId = header(request, 'x-test-mailbox');

    if (mailboxId !== null) {
      const accountId = header(request, 'x-test-mailbox-account');

      if (accountId === null) {
        return false;
      }

      request.identity = { kind: 'mailbox', mailboxId, accountId };

      return true;
    }

    const sub = header(request, 'x-test-owner');

    if (sub === null) {
      return false;
    }

    request.identity = {
      kind: 'keycloak',
      sub,
      email: header(request, 'x-test-email'),
      name: null,
      admin: header(request, 'x-test-admin') === 'true',
    };

    return true;
  }
}

function header(request: Request, name: string): string | null {
  const value = request.headers[name];

  return typeof value === 'string' && value !== '' ? value : null;
}

export function asMailbox(mailboxId: string, accountId: string): Record<string, string> {
  return { 'x-test-mailbox': mailboxId, 'x-test-mailbox-account': accountId };
}

export const AS_ADMIN: Record<string, string> = { 'x-test-admin': 'true' };

export interface ApiResult<T> {
  readonly status: number;
  readonly body: T;
}

export async function call<T>(
  harness: TestHarness,
  owner: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers: {
      'x-test-owner': owner,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text === '' ? undefined : JSON.parse(text)) as T,
  };
}

export async function callInternal<T>(
  harness: TestHarness,
  path: string,
  rawBody: string,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text === '' ? undefined : JSON.parse(text)) as T,
  };
}

export interface TestAccount {
  readonly sub: string;
  readonly accountId: string;
}

export interface TestAppOptions {
  readonly config?: Partial<Config>;
  readonly realAuth?: boolean;
}

export interface TestHarness {
  readonly app: INestApplication;
  readonly db: Database;
  readonly url: string;
  // A bare `sub` is not enough here: routes resolve it to an `account` row first.
  newAccount(status?: AccountStatus): Promise<TestAccount>;
  close(): Promise<void>;
}

type AccountStatus = 'pending' | 'active' | 'suspended';

export async function startTestApp(options: TestAppOptions = {}): Promise<TestHarness> {
  const databaseUrl = inject('databaseUrl');
  const config = { ...configFor(databaseUrl), ...options.config };

  const migrator = createDatabase(databaseUrl, { max: 1, quiet: true });
  await migrate(migrator.db, { migrationsFolder: MIGRATIONS_FOLDER });
  await migrator.close();

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config);

  if (options.realAuth !== true) {
    builder.overrideGuard(JwtGuard).useClass(FakeAuthGuard);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  // Must mirror main.ts, or every /internal test 404s for an unrelated reason.
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics', 'internal/(.*)'] });
  await app.init();
  await app.listen(0);

  const db = app.get<Database>(DATABASE);

  return {
    app,
    db,
    url: await app.getUrl(),
    newAccount: async (status: AccountStatus = 'active'): Promise<TestAccount> => {
      const sub = randomUUID();
      const accountId = randomUUID();

      await db.insert(account).values({
        id: accountId,
        keycloakSub: sub,
        email: `${sub}@example.test`,
        status,
        ...(status === 'active' ? { approvedAt: new Date() } : {}),
      });

      return { sub, accountId };
    },
    close: () => app.close(),
  };
}

function configFor(databaseUrl: string): Config {
  const parsed = new URL(databaseUrl);

  return {
    ...loadConfig({}),
    DB_HOST: parsed.hostname,
    DB_PORT: Number(parsed.port),
    POSTGRES_DB: parsed.pathname.slice(1),
    POSTGRES_USER: decodeURIComponent(parsed.username),
    POSTGRES_PASSWORD: decodeURIComponent(parsed.password),
    LOG_LEVEL: 'error' as const,
  };
}
