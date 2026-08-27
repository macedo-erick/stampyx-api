import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { domain, mailbox } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { verifyMailboxPassword } from '../mailboxes/password';
import { AS_ADMIN, type TestHarness, asMailbox, call, startTestApp } from '../test-app.fixture';
import type { AdminAccountResponse, AdminMailboxResponse } from './dto';

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

async function newTenant(name: string, localPart: string) {
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

  return { owner, mailbox: box.body };
}

function dovecotRows(address: string) {
  return harness.db.execute<{ email: string }>(
    sql`SELECT email FROM v_dovecot_users WHERE email = ${address}`,
  );
}

it('refuses the admin surface to an ordinary account', async () => {
  const { sub } = await harness.newAccount();

  const refused = await call<unknown>(harness, sub, 'GET', '/api/admin/accounts');

  expect(refused.status).toBe(403);
});

it('refuses the admin surface to a mailbox session', async () => {
  const { owner, mailbox: box } = await newTenant('admin-one.test', 'erick');

  const refused = await call<unknown>(harness, 'unused', 'GET', '/api/admin/accounts', undefined, {
    ...asMailbox(box.id, owner.accountId),
    ...AS_ADMIN,
  });

  expect(refused.status).toBe(403);
});

it('lists every account with its domain and mailbox counts', async () => {
  const { owner } = await newTenant('admin-two.test', 'erick');
  const admin = await harness.newAccount();

  const listed = await call<AdminAccountResponse[]>(
    harness,
    admin.sub,
    'GET',
    '/api/admin/accounts',
    undefined,
    AS_ADMIN,
  );

  expect(listed.status).toBe(200);

  const row = listed.body.find((item) => item.id === owner.accountId);

  expect(row?.domainCount).toBe(1);
  expect(row?.mailboxCount).toBe(1);
});

it('suspends an account and the mailbox leaves the mail plane with it', async () => {
  const { owner, mailbox: box } = await newTenant('admin-three.test', 'erick');
  const admin = await harness.newAccount();

  await expect(dovecotRows(box.address)).resolves.toHaveLength(1);

  const changed = await call<AdminAccountResponse>(
    harness,
    admin.sub,
    'PUT',
    `/api/admin/accounts/${owner.accountId}/status`,
    { status: 'suspended' },
    AS_ADMIN,
  );

  expect(changed.status).toBe(200);
  expect(changed.body.status).toBe('suspended');
  await expect(dovecotRows(box.address)).resolves.toHaveLength(0);
});

it('resets a mailbox password to something Dovecot accepts', async () => {
  const { mailbox: box } = await newTenant('admin-four.test', 'erick');
  const admin = await harness.newAccount();

  const reset = await call<unknown>(
    harness,
    admin.sub,
    'PUT',
    `/api/admin/mailboxes/${box.id}/password`,
    { password: 'issued by the administrator' },
    AS_ADMIN,
  );

  expect(reset.status).toBe(204);

  const [row] = await harness.db.select().from(mailbox).where(eq(mailbox.id, box.id));

  await expect(
    verifyMailboxPassword(row?.passwordHash ?? '', 'issued by the administrator'),
  ).resolves.toBe(true);
});

it('deletes an account and its mailboxes go with it', async () => {
  const { owner, mailbox: box } = await newTenant('admin-five.test', 'erick');
  const admin = await harness.newAccount();

  const deleted = await call<unknown>(
    harness,
    admin.sub,
    'DELETE',
    `/api/admin/accounts/${owner.accountId}`,
    undefined,
    AS_ADMIN,
  );

  expect(deleted.status).toBe(204);

  const rows = await harness.db.select().from(mailbox).where(eq(mailbox.id, box.id));

  expect(rows).toHaveLength(0);
});

it('stops an administrator from deleting their own account', async () => {
  const admin = await harness.newAccount();

  const refused = await call<unknown>(
    harness,
    admin.sub,
    'DELETE',
    `/api/admin/accounts/${admin.accountId}`,
    undefined,
    AS_ADMIN,
  );

  expect(refused.status).toBe(400);
});

it('lists mailboxes across every tenant', async () => {
  const { mailbox: box } = await newTenant('admin-six.test', 'erick');
  const admin = await harness.newAccount();

  const listed = await call<AdminMailboxResponse[]>(
    harness,
    admin.sub,
    'GET',
    '/api/admin/mailboxes',
    undefined,
    AS_ADMIN,
  );

  expect(listed.body.some((row) => row.address === box.address)).toBe(true);
});
