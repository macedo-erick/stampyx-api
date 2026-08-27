import { eq } from 'drizzle-orm';
import { type MockInstance, afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { RuleResponse } from './dto';
import { SieveWriter } from './sieve.writer';

let harness: TestHarness;
let write: MockInstance<SieveWriter['write']>;

beforeAll(async () => {
  harness = await startTestApp();

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);

  write = vi.spyOn(harness.app.get(SieveWriter), 'write').mockResolvedValue(undefined);
});

beforeEach(() => {
  write.mockClear();
});

afterAll(async () => {
  await harness.close();
});

async function newMailbox(sub: string, name: string): Promise<string> {
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', { name });
  await harness.db
    .update(domain)
    .set({ verifiedAt: new Date() })
    .where(eq(domain.id, created.body.id));

  const mailbox = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${created.body.id}/mailboxes`,
    { localPart: 'owner', password: 'a long enough password' },
  );

  return mailbox.body.id;
}

const RULE = {
  conditionField: 'sender',
  conditionOperator: 'contains',
  conditionValue: '@hetzner.com',
  action: 'move_to',
  targetFolder: 'Infra',
};

it('creates a rule and regenerates the Sieve script', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-one.com');

  write.mockClear();

  const created = await call<RuleResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/rules`,
    RULE,
  );

  expect(created.status).toBe(201);
  expect(created.body.position).toBe(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it('appends each new rule after the last', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-two.com');

  const first = await call<RuleResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/rules`,
    RULE,
  );
  const second = await call<RuleResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/rules`,
    { ...RULE, conditionValue: '@other.com' },
  );

  expect([first.body.position, second.body.position]).toEqual([1, 2]);
});

it('reorders rules and renumbers them contiguously from one', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-three.com');

  const ids: string[] = [];
  for (const value of ['a.com', 'b.com', 'c.com']) {
    const created = await call<RuleResponse>(
      harness,
      sub,
      'POST',
      `/api/mailboxes/${mailboxId}/rules`,
      { ...RULE, conditionValue: value },
    );
    ids.push(created.body.id);
  }

  const reordered = await call<RuleResponse[]>(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/rules/order`,
    { ruleIds: [ids[2], ids[0], ids[1]] },
  );

  expect(reordered.status).toBe(200);
  expect(reordered.body.map((rule) => rule.id)).toEqual([ids[2], ids[0], ids[1]]);
  expect(reordered.body.map((rule) => rule.position)).toEqual([1, 2, 3]);
});

it('refuses a reorder that does not list every rule exactly once', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-four.com');

  const ids: string[] = [];
  for (const value of ['a.com', 'b.com']) {
    const created = await call<RuleResponse>(
      harness,
      sub,
      'POST',
      `/api/mailboxes/${mailboxId}/rules`,
      { ...RULE, conditionValue: value },
    );
    ids.push(created.body.id);
  }

  const partial = await call(harness, sub, 'PUT', `/api/mailboxes/${mailboxId}/rules/order`, {
    ruleIds: [ids[0]],
  });
  const duplicated = await call(harness, sub, 'PUT', `/api/mailboxes/${mailboxId}/rules/order`, {
    ruleIds: [ids[0], ids[0]],
  });

  expect([partial.status, duplicated.status]).toEqual([400, 400]);
});

it('rejects a move_to with no target folder', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-five.com');

  const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/rules`, {
    ...RULE,
    targetFolder: null,
  });

  expect(result.status).toBe(400);
});

it('rejects an unknown field, operator or action', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-six.com');

  for (const override of [
    { conditionField: 'body' },
    { conditionOperator: 'regex' },
    { action: 'delete_everything' },
  ]) {
    const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/rules`, {
      ...RULE,
      ...override,
    });

    expect(result.status, JSON.stringify(override)).toBe(400);
  }
});

it("answers 404 for rules on another account's mailbox", async () => {
  const owner = await harness.newAccount();
  const stranger = await harness.newAccount();
  const mailboxId = await newMailbox(owner.sub, 'rules-private.com');

  const created = await call<RuleResponse>(
    harness,
    owner.sub,
    'POST',
    `/api/mailboxes/${mailboxId}/rules`,
    RULE,
  );

  const listed = await call(harness, stranger.sub, 'GET', `/api/mailboxes/${mailboxId}/rules`);
  const updated = await call(
    harness,
    stranger.sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/rules/${created.body.id}`,
    RULE,
  );
  const removed = await call(
    harness,
    stranger.sub,
    'DELETE',
    `/api/mailboxes/${mailboxId}/rules/${created.body.id}`,
  );

  expect([listed.status, updated.status, removed.status]).toEqual([404, 404, 404]);
});

it('does not regenerate the script when the rule was not found', async () => {
  const { sub } = await harness.newAccount();
  const mailboxId = await newMailbox(sub, 'rules-seven.com');

  write.mockClear();

  const result = await call(
    harness,
    sub,
    'DELETE',
    `/api/mailboxes/${mailboxId}/rules/00000000-0000-4000-8000-000000000000`,
  );

  expect(result.status).toBe(404);
  expect(write).not.toHaveBeenCalled();
});
