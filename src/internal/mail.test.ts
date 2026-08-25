import { eq } from 'drizzle-orm';
import { type MockInstance, afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain, receivedMessage, sentMessage } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import { MailGateway } from './mail.gateway';

const SECRET = 'test-internal-secret';
const AUTH = { 'x-stampyx-internal': SECRET };

let harness: TestHarness;
let emit: MockInstance<MailGateway['emitReceived']>;

beforeAll(async () => {
  harness = await startTestApp({ config: { MAIL_INTERNAL_SECRET: SECRET } });

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);

  emit = vi.spyOn(harness.app.get(MailGateway), 'emitReceived').mockReturnValue(undefined);
});

beforeEach(() => {
  emit.mockClear();
});

afterAll(async () => {
  await harness.close();
});

async function newMailbox(name: string, localPart = 'erick'): Promise<string> {
  const { sub } = await harness.newAccount();
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
    { localPart, password: 'a long enough password' },
  );

  return mailbox.body.id;
}

interface InternalResult {
  status: number;
  body: { status?: string };
}

async function post(path: string, body: unknown, headers = AUTH): Promise<InternalResult> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text === '' ? {} : JSON.parse(text)) as { status?: string },
  };
}

it('records a delivery and pushes it to the mailbox room', async () => {
  const mailboxId = await newMailbox('inbound-one.com');

  const result = await post('/internal/mail/received', {
    mailbox: 'erick@inbound-one.com',
    messageId: '<a@example.test>',
    sender: 'sender@example.test',
    subject: 'Hello',
  });

  expect(result.status).toBe(202);
  expect(result.body.status).toBe('recorded');
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0]?.[0]).toMatchObject({ mailboxId, folder: 'INBOX' });
});

it('is idempotent, because Sieve runs before delivery is confirmed', async () => {
  const mailboxId = await newMailbox('inbound-two.com');
  const payload = {
    mailbox: 'erick@inbound-two.com',
    messageId: '<dupe@example.test>',
    sender: 'sender@example.test',
    subject: 'Twice',
  };

  const first = await post('/internal/mail/received', payload);
  const second = await post('/internal/mail/received', payload);

  expect(first.body.status).toBe('recorded');
  expect(second.status).toBe(202);
  expect(second.body.status).toBe('already-recorded');

  const rows = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, mailboxId));

  expect(rows).toHaveLength(1);
  // The second delivery must not fire a second toast in the panel.
  expect(emit).toHaveBeenCalledTimes(1);
});

it('does not notify for mail Sieve filed as spam', async () => {
  await newMailbox('inbound-spam.com');

  await post('/internal/mail/received', {
    mailbox: 'erick@inbound-spam.com',
    messageId: '<spam@example.test>',
    sender: 'spammer@example.test',
    subject: 'Win big',
    folder: 'Spam',
    spamScore: 12,
  });

  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit.mock.calls[0]?.[0]).toMatchObject({ folder: 'Spam' });
});

it('records a send and updates its status as the milter reports back', async () => {
  const mailboxId = await newMailbox('outbound-one.com');
  const payload = {
    mailbox: 'erick@outbound-one.com',
    messageId: '<out@example.test>',
    recipient: 'someone@example.test',
    subject: 'Hi',
  };

  await post('/internal/mail/sent', payload);
  await post('/internal/mail/sent', { ...payload, status: 'delivered', smtpResponseCode: '250' });

  const rows = await harness.db
    .select()
    .from(sentMessage)
    .where(eq(sentMessage.mailboxId, mailboxId));

  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe('delivered');
  expect(rows[0]?.smtpResponseCode).toBe('250');
});

it('refuses a call with no internal credential', async () => {
  await newMailbox('inbound-noauth.com');

  const result = await post(
    '/internal/mail/received',
    { mailbox: 'erick@inbound-noauth.com', messageId: '<x@y>', sender: 's@e.test' },
    {} as typeof AUTH,
  );

  expect(result.status).toBe(401);
});

it('refuses a call with the wrong internal credential', async () => {
  await newMailbox('inbound-badauth.com');

  const result = await post(
    '/internal/mail/received',
    { mailbox: 'erick@inbound-badauth.com', messageId: '<x@y>', sender: 's@e.test' },
    { 'x-stampyx-internal': 'wrong' },
  );

  expect(result.status).toBe(401);
});

it('answers 404 for a mailbox that does not exist', async () => {
  const result = await post('/internal/mail/received', {
    mailbox: 'nobody@nowhere-at-all.com',
    messageId: '<x@y>',
    sender: 's@e.test',
  });

  expect(result.status).toBe(404);
});

it('does not confuse two mailboxes with the same local part on different domains', async () => {
  const first = await newMailbox('same-name-a.com', 'info');
  const second = await newMailbox('same-name-b.com', 'info');

  await post('/internal/mail/received', {
    mailbox: 'info@same-name-b.com',
    messageId: '<routed@example.test>',
    sender: 's@e.test',
  });

  const toFirst = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, first));
  const toSecond = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, second));

  expect(toFirst).toHaveLength(0);
  expect(toSecond).toHaveLength(1);
});
