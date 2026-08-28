import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { domain, receivedMessage } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { RulePreviewResponse } from './dto';

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

async function newMailbox(name: string) {
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
    { localPart: 'erick', password: 'correct horse battery' },
  );

  return { sub: owner.sub, mailboxId: box.body.id };
}

async function seed(mailboxId: string, sender: string, subject: string) {
  await harness.db.insert(receivedMessage).values({
    id: randomUUID(),
    mailboxId,
    messageId: `<${randomUUID()}@preview.test>`,
    sender,
    subject,
    folder: 'INBOX',
  });
}

function preview(sub: string, mailboxId: string, body: Record<string, string>) {
  return call<RulePreviewResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/rules/preview`,
    body,
  );
}

it('counts what a rule would have caught, with a sample', async () => {
  const { sub, mailboxId } = await newMailbox('preview-one.test');

  await seed(mailboxId, 'maria@empresa.com', 'Proposta');
  await seed(mailboxId, 'joao@empresa.com', 'Reunião');
  await seed(mailboxId, 'carla@outra.com', 'Fatura');

  const result = await preview(sub, mailboxId, {
    conditionField: 'sender',
    conditionOperator: 'contains',
    conditionValue: '@empresa.com',
  });

  expect(result.status).toBe(200);
  expect(result.body.supported).toBe(true);
  expect(result.body.total).toBe(2);
  expect(result.body.sample).toHaveLength(2);
});

it('honours the operator rather than always matching loosely', async () => {
  const { sub, mailboxId } = await newMailbox('preview-two.test');

  await seed(mailboxId, 'a@x.test', 'NF-e 001');
  await seed(mailboxId, 'b@x.test', 'Sobre a NF-e 002');

  const starts = await preview(sub, mailboxId, {
    conditionField: 'subject',
    conditionOperator: 'starts_with',
    conditionValue: 'NF-e',
  });
  const contains = await preview(sub, mailboxId, {
    conditionField: 'subject',
    conditionOperator: 'contains',
    conditionValue: 'NF-e',
  });

  expect(starts.body.total).toBe(1);
  expect(contains.body.total).toBe(2);
});

it('treats a percent in the value as text, not as a wildcard', async () => {
  const { sub, mailboxId } = await newMailbox('preview-three.test');

  await seed(mailboxId, 'promo@x.test', '50% de desconto');
  await seed(mailboxId, 'outro@x.test', 'nada a ver');

  const result = await preview(sub, mailboxId, {
    conditionField: 'subject',
    conditionOperator: 'contains',
    conditionValue: '%',
  });

  expect(result.body.total).toBe(1);
});

it('says plainly that a recipient rule cannot be previewed', async () => {
  const { sub, mailboxId } = await newMailbox('preview-four.test');

  await seed(mailboxId, 'a@x.test', 'oi');

  const result = await preview(sub, mailboxId, {
    conditionField: 'recipient',
    conditionOperator: 'contains',
    conditionValue: 'vendas@',
  });

  expect(result.body.supported).toBe(false);
  expect(result.body.total).toBe(0);
});

it('does not count another mailbox messages', async () => {
  const mine = await newMailbox('preview-five.test');
  const theirs = await newMailbox('preview-six.test');

  await seed(theirs.mailboxId, 'maria@empresa.com', 'Proposta');

  const result = await preview(mine.sub, mine.mailboxId, {
    conditionField: 'sender',
    conditionOperator: 'contains',
    conditionValue: '@empresa.com',
  });

  expect(result.body.total).toBe(0);
});
