import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { account } from '../database/schema';
import type { MailboxResponse } from '../mailboxes/dto';
import { verifyMailboxPassword } from '../mailboxes/password';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { AvailabilityResponse, MeResponse } from './dto';

const PLATFORM = 'platform-me.test';

let harness: TestHarness;
let platformDomainId: string;

beforeAll(async () => {
  harness = await startTestApp({ config: { STAMPYX_PLATFORM_DOMAINS: [PLATFORM] } });

  const [row] = await harness.db.execute<{ id: string }>(
    sql`SELECT id FROM domain WHERE name = ${PLATFORM}`,
  );

  platformDomainId = row?.id ?? '';
});

afterAll(async () => {
  await harness.close();
});

async function claim(sub: string, localPart: string) {
  return call<MailboxResponse>(harness, sub, 'POST', '/api/me/address', {
    localPart,
    domainId: platformDomainId,
  });
}

it('gives a fresh account the address it registered with, without asking', async () => {
  const { sub } = await harness.newAccount();

  const me = await call<MeResponse>(harness, sub, 'GET', '/api/me');

  expect(me.status).toBe(200);
  expect(me.body.kind).toBe('account');
  expect(me.body.needsAddress).toBe(false);
  expect(me.body.platformAddress).toBe(`${sub}@${PLATFORM}`);
});

it('falls back to asking when the name it would take is already gone', async () => {
  const first = await harness.newAccount();
  const second = await harness.newAccount();

  await harness.db
    .update(account)
    .set({ email: `duplicada@${PLATFORM}` })
    .where(eq(account.id, first.accountId));
  await harness.db
    .update(account)
    .set({ email: `duplicada@${PLATFORM}` })
    .where(eq(account.id, second.accountId));

  const winner = await call<MeResponse>(harness, first.sub, 'GET', '/api/me');
  const loser = await call<MeResponse>(harness, second.sub, 'GET', '/api/me');

  expect(winner.body.platformAddress).toBe(`duplicada@${PLATFORM}`);
  expect(loser.body.needsAddress).toBe(true);
  expect(loser.body.suggestedLocalPart).toBe('duplicada');
});

it('claims an address that is deliverable straight away', async () => {
  const { sub } = await harness.newAccount();

  const created = await claim(sub, 'joana');

  expect(created.status).toBe(201);
  expect(created.body.address).toBe(`joana@${PLATFORM}`);
  expect(created.body.deliverable).toBe(true);
  expect(created.body.platform).toBe(true);

  const me = await call<MeResponse>(harness, sub, 'GET', '/api/me');

  expect(me.body.needsAddress).toBe(false);
  expect(me.body.platformAddress).toBe(`joana@${PLATFORM}`);
});

it('reaches Dovecot with a password nobody can use until one is set', async () => {
  const { sub } = await harness.newAccount();
  await claim(sub, 'marcos');

  const rows = await harness.db.execute<{ email: string; password_hash: string }>(
    sql`SELECT email, password_hash FROM v_dovecot_users WHERE email = ${`marcos@${PLATFORM}`}`,
  );

  expect(rows).toHaveLength(1);
  await expect(verifyMailboxPassword(rows[0]?.password_hash ?? '', '')).resolves.toBe(false);
});

it('refuses a reserved local part', async () => {
  const { sub } = await harness.newAccount();

  const created = await claim(sub, 'postmaster');

  expect(created.status).toBe(409);
});

it('refuses an address someone else already holds', async () => {
  const first = await harness.newAccount();
  const second = await harness.newAccount();

  await claim(first.sub, 'duplicada');
  const created = await claim(second.sub, 'duplicada');

  expect(created.status).toBe(409);
});

it('returns the same address when the same claim is replayed', async () => {
  const { sub } = await harness.newAccount();

  const first = await claim(sub, 'reenviada');
  const second = await claim(sub, 'reenviada');

  expect(second.status).toBe(201);
  expect(second.body.id).toBe(first.body.id);
});

it('refuses a second, different address on the same account', async () => {
  const { sub } = await harness.newAccount();

  await claim(sub, 'primeira');
  const created = await claim(sub, 'segunda');

  expect(created.status).toBe(409);
});

it('reports availability, counting reserved names as taken', async () => {
  const { sub } = await harness.newAccount();
  await claim(sub, 'ocupada');

  const free = await call<AvailabilityResponse>(
    harness,
    sub,
    'GET',
    `/api/me/address/availability?domainId=${platformDomainId}&localPart=livre`,
  );
  const taken = await call<AvailabilityResponse>(
    harness,
    sub,
    'GET',
    `/api/me/address/availability?domainId=${platformDomainId}&localPart=ocupada`,
  );
  const reserved = await call<AvailabilityResponse>(
    harness,
    sub,
    'GET',
    `/api/me/address/availability?domainId=${platformDomainId}&localPart=abuse`,
  );

  expect(free.body.available).toBe(true);
  expect(taken.body.available).toBe(false);
  expect(reserved.body.available).toBe(false);
});
