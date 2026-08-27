import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { account, domain, mailbox, mailboxSession } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { verifyMailboxPassword } from '../mailboxes/password';
import { type TestHarness, asMailbox, call, startTestApp } from '../test-app.fixture';
import type { MailboxSessionResponse } from './dto';

const PASSWORD = 'correct horse battery';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);
});

afterAll(async () => {
  await harness.close();
});

async function newMailbox(name: string, localPart: string) {
  const owner = await harness.newAccount();

  const created = await call<DomainResponse>(harness, owner.sub, 'POST', '/api/domains', { name });

  await harness.db
    .update(domain)
    .set({ verifiedAt: new Date() })
    .where(eq(domain.id, created.body.id));

  const box = await call<MailboxResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/domains/${created.body.id}/mailboxes`,
    { localPart, password: PASSWORD },
  );

  return { owner, domainId: created.body.id, mailbox: box.body };
}

function login(email: string, password: string) {
  return call<MailboxSessionResponse>(harness, 'unused', 'POST', '/api/auth/mailbox/login', {
    email,
    password,
  });
}

it('signs a mailbox in with the password Dovecot checks', async () => {
  const { mailbox: box } = await newMailbox('auth-one.test', 'erick');

  const session = await login(box.address, PASSWORD);

  expect(session.status).toBe(200);
  expect(session.body.address).toBe(box.address);
  expect(session.body.accessToken.length).toBeGreaterThan(0);
  expect(session.body.refreshToken.length).toBeGreaterThan(0);
});

it('answers a wrong password exactly as it answers an unknown address', async () => {
  const { mailbox: box } = await newMailbox('auth-two.test', 'erick');

  const wrong = await login(box.address, 'not the password');
  const unknown = await login('ninguem@auth-two.test', PASSWORD);

  expect(wrong.status).toBe(401);
  expect(unknown.status).toBe(401);
  expect(wrong.body).toMatchObject({ message: 'Invalid address or password' });
  expect(unknown.body).toMatchObject({ message: 'Invalid address or password' });
});

it('locks a mailbox out after repeated failures', async () => {
  const { mailbox: box } = await newMailbox('auth-three.test', 'erick');

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await login(box.address, 'wrong');
  }

  const locked = await login(box.address, PASSWORD);

  expect(locked.status).toBe(429);
});

it('refuses a mailbox whose account has been suspended', async () => {
  const { owner, mailbox: box } = await newMailbox('auth-four.test', 'erick');

  await harness.db
    .update(account)
    .set({ status: 'suspended' })
    .where(eq(account.id, owner.accountId));

  const refused = await login(box.address, PASSWORD);

  expect(refused.status).toBe(403);
});

it('rotates the refresh token so a captured one is good once', async () => {
  const { mailbox: box } = await newMailbox('auth-five.test', 'erick');
  const session = await login(box.address, PASSWORD);

  const first = await call<MailboxSessionResponse>(
    harness,
    'unused',
    'POST',
    '/api/auth/mailbox/refresh',
    { refreshToken: session.body.refreshToken },
  );
  const replayed = await call<MailboxSessionResponse>(
    harness,
    'unused',
    'POST',
    '/api/auth/mailbox/refresh',
    { refreshToken: session.body.refreshToken },
  );

  expect(first.status).toBe(200);
  expect(replayed.status).toBe(401);
});

it('changes the mail password and drops every other session', async () => {
  const { mailbox: box } = await newMailbox('auth-six.test', 'erick');
  await login(box.address, PASSWORD);
  await login(box.address, PASSWORD);

  const changed = await call<unknown>(
    harness,
    'unused',
    'PUT',
    '/api/auth/mailbox/password',
    { currentPassword: PASSWORD, newPassword: 'a completely different one' },
    asMailbox(box.id, (await ownerOf(box.id)) ?? ''),
  );

  expect(changed.status).toBe(204);

  const sessions = await harness.db
    .select()
    .from(mailboxSession)
    .where(eq(mailboxSession.mailboxId, box.id));

  expect(sessions).toHaveLength(0);

  const [row] = await harness.db.select().from(mailbox).where(eq(mailbox.id, box.id));

  await expect(
    verifyMailboxPassword(row?.passwordHash ?? '', 'a completely different one'),
  ).resolves.toBe(true);
});

it('refuses a password change that cannot present the current password', async () => {
  const { mailbox: box } = await newMailbox('auth-seven.test', 'erick');

  const refused = await call<unknown>(
    harness,
    'unused',
    'PUT',
    '/api/auth/mailbox/password',
    { currentPassword: 'guessing', newPassword: 'a completely different one' },
    asMailbox(box.id, (await ownerOf(box.id)) ?? ''),
  );

  expect(refused.status).toBe(403);
});

it('hides a sibling mailbox on the same domain from a mailbox session', async () => {
  const { owner, domainId, mailbox: mine } = await newMailbox('auth-eight.test', 'erick');

  const sibling = await call<MailboxResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'colega', password: PASSWORD },
  );

  const headers = asMailbox(mine.id, owner.accountId);

  const own = await call<MailboxResponse>(
    harness,
    'unused',
    'GET',
    `/api/mailboxes/${mine.id}`,
    undefined,
    headers,
  );
  const theirs = await call<MailboxResponse>(
    harness,
    'unused',
    'GET',
    `/api/mailboxes/${sibling.body.id}`,
    undefined,
    headers,
  );
  const theirMessages = await call<unknown>(
    harness,
    'unused',
    'GET',
    `/api/mailboxes/${sibling.body.id}/messages`,
    undefined,
    headers,
  );

  expect(own.status).toBe(200);
  expect(theirs.status).toBe(404);
  expect(theirMessages.status).toBe(404);
});

async function ownerOf(mailboxId: string): Promise<string | null> {
  const [row] = await harness.db.select().from(mailbox).where(eq(mailbox.id, mailboxId));

  return row?.accountId ?? null;
}
