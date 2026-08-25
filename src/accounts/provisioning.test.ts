import { createHmac, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { account } from '../database/schema';
import { type TestHarness, call, callInternal, startTestApp } from '../test-app.fixture';
import { KeycloakAdminClient } from './keycloak-admin.client';

const SECRET = 'test-provisioning-secret';
const PATH = '/internal/keycloak/user-registered';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp({
    config: { STAMPYX_PROVISIONING_SECRET: SECRET, KEYCLOAK_REALM: 'stampyx' },
  });

  vi.spyOn(harness.app.get(KeycloakAdminClient), 'findUser').mockImplementation((id: string) =>
    Promise.resolve({ id, email: `${id}@example.test`, firstName: 'Ada', lastName: 'Lovelace' }),
  );
});

afterAll(async () => {
  await harness.close();
});

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    userId: randomUUID(),
    realm: 'stampyx',
    timestamp: Date.now(),
    ...overrides,
  });
}

function sign(raw: string, secret = SECRET): Record<string, string> {
  return {
    'x-planelyx-signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
  };
}

it('provisions a pending account from a correctly signed registration event', async () => {
  const raw = body();
  const userId = (JSON.parse(raw) as { userId: string }).userId;

  const result = await callInternal<{ status: string }>(harness, PATH, raw, sign(raw));

  expect(result.status).toBe(202);
  expect(result.body.status).toBe('created');

  const [row] = await harness.db.select().from(account).where(eq(account.keycloakSub, userId));

  expect(row?.email).toBe(`${userId}@example.test`);
  expect(row?.name).toBe('Ada Lovelace');
  // Registration alone must not grant standing.
  expect(row?.status).toBe('pending');
  expect(row?.approvedAt).toBeNull();
});

it('treats a redelivery of the same event as a no-op, because the SPI is at-least-once', async () => {
  const raw = body();
  const userId = (JSON.parse(raw) as { userId: string }).userId;

  const first = await callInternal<{ status: string }>(harness, PATH, raw, sign(raw));
  const second = await callInternal<{ status: string }>(harness, PATH, raw, sign(raw));

  expect(first.body.status).toBe('created');
  expect(second.status).toBe(202);
  expect(second.body.status).toBe('already-provisioned');

  const rows = await harness.db.select().from(account).where(eq(account.keycloakSub, userId));

  expect(rows).toHaveLength(1);
});

it('rejects a body signed with the wrong secret', async () => {
  const raw = body();

  const result = await callInternal(harness, PATH, raw, sign(raw, 'not-the-secret'));

  expect(result.status).toBe(401);
});

it('rejects a body with no signature at all', async () => {
  const raw = body();

  const result = await callInternal(harness, PATH, raw);

  expect(result.status).toBe(401);
});

it('rejects a signature that is valid for different bytes than the ones sent', async () => {
  const signed = body();
  const sent = body();

  const result = await callInternal(harness, PATH, sent, sign(signed));

  expect(result.status).toBe(401);
});

it('rejects an event stamped outside the replay window', async () => {
  const raw = body({ timestamp: Date.now() - 10 * 60 * 1000 });

  const result = await callInternal(harness, PATH, raw, sign(raw));

  expect(result.status).toBe(401);
});

it('rejects a correctly signed event that belongs to another realm', async () => {
  const raw = body({ realm: 'listryx' });

  const result = await callInternal(harness, PATH, raw, sign(raw));

  expect(result.status).toBe(401);
});

it('rejects a signed body that is not a well-formed event', async () => {
  const raw = JSON.stringify({ userId: 'not-a-uuid', realm: 'stampyx', timestamp: Date.now() });

  const result = await callInternal(harness, PATH, raw, sign(raw));

  expect(result.status).toBe(400);
});

it('self-provisions from the token when the registration event never arrived', async () => {
  const sub = randomUUID();

  const before = await harness.db.select().from(account).where(eq(account.keycloakSub, sub));

  expect(before).toHaveLength(0);

  const result = await call(harness, sub, 'GET', '/api/domains', undefined, {
    'x-test-email': 'grace@stampyx.com',
  });

  expect(result.status).toBe(200);

  const [row] = await harness.db.select().from(account).where(eq(account.keycloakSub, sub));

  expect(row?.email).toBe('grace@stampyx.com');
  expect(row?.status).toBe('active');
  expect(row?.approvedAt).not.toBeNull();
});

it('leaves a self-provisioned account pending when auto-approval is off', async () => {
  const gated = await startTestApp({
    config: { STAMPYX_PROVISIONING_SECRET: SECRET, STAMPYX_ACCOUNT_AUTO_APPROVE: false },
  });

  try {
    const sub = randomUUID();
    const result = await call(gated, sub, 'GET', '/api/domains', undefined, {
      'x-test-email': 'gated@stampyx.com',
    });

    expect(result.status).toBe(403);

    const [row] = await gated.db.select().from(account).where(eq(account.keycloakSub, sub));

    expect(row?.status).toBe('pending');
  } finally {
    await gated.close();
  }
});

it('still refuses a token that carries no email, since there is nothing to provision from', async () => {
  const result = await call(harness, randomUUID(), 'GET', '/api/domains');

  expect(result.status).toBe(401);
});
