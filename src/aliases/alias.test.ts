import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { alias, domain } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, asMailbox, call, startTestApp } from '../test-app.fixture';
import type { AliasResponse } from './dto';

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

it('shows a mailbox the aliases that deliver to it, and no others', async () => {
  const owner = await harness.newAccount();

  const created = await call<DomainResponse>(harness, owner.sub, 'POST', '/api/domains', {
    name: 'alias-one.test',
  });

  await harness.db
    .update(domain)
    .set({ verifiedAt: new Date() })
    .where(eq(domain.id, created.body.id));

  const mine = await call<MailboxResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/domains/${created.body.id}/mailboxes`,
    { localPart: 'erick', password: 'correct horse battery' },
  );
  const other = await call<MailboxResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/domains/${created.body.id}/mailboxes`,
    { localPart: 'colega', password: 'correct horse battery' },
  );

  await harness.db.insert(alias).values([
    {
      id: randomUUID(),
      domainId: created.body.id,
      source: `vendas@alias-one.test`,
      destination: mine.body.address,
    },
    {
      id: randomUUID(),
      domainId: created.body.id,
      source: `financeiro@alias-one.test`,
      destination: other.body.address,
    },
  ]);

  const listed = await call<AliasResponse[]>(
    harness,
    'unused',
    'GET',
    `/api/mailboxes/${mine.body.id}/aliases`,
    undefined,
    asMailbox(mine.body.id, owner.accountId),
  );

  expect(listed.status).toBe(200);
  expect(listed.body.map((row) => row.source)).toEqual(['vendas@alias-one.test']);
});
