import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { domain, mailbox } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { MailboxResponse } from './dto';
import { DOVECOT_SCHEME, verifyMailboxPassword } from './password';

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

async function newDomain(sub: string, name: string, verified = false): Promise<string> {
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', { name });

  if (verified) {
    await harness.db
      .update(domain)
      .set({ verifiedAt: new Date() })
      .where(eq(domain.id, created.body.id));
  }

  return created.body.id;
}

const GOOD_PASSWORD = 'correct horse battery';

it('creates a mailbox and stores a Dovecot-readable argon2id hash', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'mailbox-one.com', true);

  const created = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'erick', password: GOOD_PASSWORD },
  );

  expect(created.status).toBe(201);
  expect(created.body.address).toBe('erick@mailbox-one.com');
  expect(created.body.deliverable).toBe(true);

  const [row] = await harness.db.select().from(mailbox).where(eq(mailbox.id, created.body.id));

  expect(row?.passwordHash.startsWith(`${DOVECOT_SCHEME}$argon2id$`)).toBe(true);
  await expect(verifyMailboxPassword(row?.passwordHash ?? '', GOOD_PASSWORD)).resolves.toBe(true);
  await expect(verifyMailboxPassword(row?.passwordHash ?? '', 'wrong')).resolves.toBe(false);
});

it('never returns the password hash to a client', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'mailbox-two.com', true);

  const created = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'quiet', password: GOOD_PASSWORD },
  );

  const fetched = await call(harness, sub, 'GET', `/api/mailboxes/${created.body.id}`);

  expect(JSON.stringify(created.body)).not.toContain('argon2');
  expect(JSON.stringify(fetched.body)).not.toContain('argon2');
});

it('reports a mailbox on an unverified domain as not deliverable', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'unverified-mailbox.com', false);

  const created = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'early', password: GOOD_PASSWORD },
  );

  expect(created.body.deliverable).toBe(false);
});

it('refuses a duplicate mailbox on the same domain', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'dupe.com', true);
  const body = { localPart: 'taken', password: GOOD_PASSWORD };

  await call(harness, sub, 'POST', `/api/domains/${domainId}/mailboxes`, body);
  const second = await call(harness, sub, 'POST', `/api/domains/${domainId}/mailboxes`, body);

  expect(second.status).toBe(409);
});

it('allows the same local part on two different domains', async () => {
  const { sub } = await harness.newAccount();
  const first = await newDomain(sub, 'alpha-side.com', true);
  const second = await newDomain(sub, 'beta-side.com', true);
  const body = { localPart: 'info', password: GOOD_PASSWORD };

  const a = await call(harness, sub, 'POST', `/api/domains/${first}/mailboxes`, body);
  const b = await call(harness, sub, 'POST', `/api/domains/${second}/mailboxes`, body);

  expect([a.status, b.status]).toEqual([201, 201]);
});

it("answers 404 for a mailbox on another account's domain", async () => {
  const owner = await harness.newAccount();
  const stranger = await harness.newAccount();
  const domainId = await newDomain(owner.sub, 'not-yours.com', true);

  const created = await call<MailboxResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'secret', password: GOOD_PASSWORD },
  );

  const read = await call(harness, stranger.sub, 'GET', `/api/mailboxes/${created.body.id}`);
  const reset = await call(
    harness,
    stranger.sub,
    'PUT',
    `/api/mailboxes/${created.body.id}/password`,
    { password: 'attacker-chosen-pw' },
  );
  const removed = await call(harness, stranger.sub, 'DELETE', `/api/mailboxes/${created.body.id}`);

  expect([read.status, reset.status, removed.status]).toEqual([404, 404, 404]);
});

it("answers 404 when listing mailboxes on another account's domain", async () => {
  const owner = await harness.newAccount();
  const stranger = await harness.newAccount();
  const domainId = await newDomain(owner.sub, 'hidden-list.com', true);

  const listed = await call(harness, stranger.sub, 'GET', `/api/domains/${domainId}/mailboxes`);

  expect(listed.status).toBe(404);
});

it('changes the password so the old one stops verifying', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'rotate.com', true);

  const created = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${domainId}/mailboxes`,
    { localPart: 'rotate', password: GOOD_PASSWORD },
  );

  const changed = await call(harness, sub, 'PUT', `/api/mailboxes/${created.body.id}/password`, {
    password: 'a completely different one',
  });

  expect(changed.status).toBe(204);

  const [row] = await harness.db.select().from(mailbox).where(eq(mailbox.id, created.body.id));

  await expect(verifyMailboxPassword(row?.passwordHash ?? '', GOOD_PASSWORD)).resolves.toBe(false);
  await expect(
    verifyMailboxPassword(row?.passwordHash ?? '', 'a completely different one'),
  ).resolves.toBe(true);
});

it('rejects a password shorter than the realm policy allows', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'weak.com', true);

  const result = await call(harness, sub, 'POST', `/api/domains/${domainId}/mailboxes`, {
    localPart: 'weak',
    password: 'short',
  });

  expect(result.status).toBe(400);
});

it('rejects a local part that is not a valid mailbox name', async () => {
  const { sub } = await harness.newAccount();
  const domainId = await newDomain(sub, 'names.com', true);

  for (const localPart of ['has space', '.leading', 'trailing.', 'two..dots', 'with@at']) {
    const result = await call(harness, sub, 'POST', `/api/domains/${domainId}/mailboxes`, {
      localPart,
      password: GOOD_PASSWORD,
    });

    expect(result.status, localPart).toBe(400);
  }
});
