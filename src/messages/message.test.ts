import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { type MockInstance, afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain, receivedMessage } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { MessageDetail, MessageSummary } from './dto';
import { ImapClient } from './imap.client';
import { MessageService } from './message.service';

let harness: TestHarness;
let imap: {
  fetchBody: MockInstance<ImapClient['fetchBody']>;
  setSeen: MockInstance<ImapClient['setSeen']>;
  move: MockInstance<ImapClient['move']>;
  remove: MockInstance<ImapClient['remove']>;
};

beforeAll(async () => {
  harness = await startTestApp();

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);

  const client = harness.app.get(ImapClient);
  imap = {
    fetchBody: vi.spyOn(client, 'fetchBody').mockResolvedValue({
      html: '<p>Hello <script>alert(1)</script></p>',
      text: 'Hello',
      attachments: [],
    }),
    setSeen: vi.spyOn(client, 'setSeen').mockResolvedValue(undefined),
    move: vi.spyOn(client, 'move').mockResolvedValue(undefined),
    remove: vi.spyOn(client, 'remove').mockResolvedValue(undefined),
  };

  // The service asks the server which folder carries \Sent and which carries \Trash, so a
  // folder listing has to exist even for the Postgres-backed paths.
  vi.spyOn(client, 'listFolders').mockResolvedValue([
    { path: 'INBOX', delimiter: '/', specialUse: null },
    { path: 'Sent', delimiter: '/', specialUse: '\\Sent' },
    { path: 'Trash', delimiter: '/', specialUse: '\\Trash' },
    { path: 'Spam', delimiter: '/', specialUse: '\\Junk' },
  ]);
  vi.spyOn(client, 'findUid').mockResolvedValue(41);
});

beforeEach(() => {
  imap.fetchBody.mockClear();
  imap.setSeen.mockClear();
  imap.move.mockClear();
  imap.remove.mockClear();
});

afterAll(async () => {
  await harness.close();
});

interface Fixture {
  sub: string;
  mailboxId: string;
}

async function newMailbox(name: string, verified = true): Promise<Fixture> {
  const { sub } = await harness.newAccount();
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', { name });

  if (verified) {
    await harness.db
      .update(domain)
      .set({ verifiedAt: new Date() })
      .where(eq(domain.id, created.body.id));
  }

  const mailbox = await call<MailboxResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${created.body.id}/mailboxes`,
    { localPart: 'erick', password: 'a long enough password' },
  );

  return { sub, mailboxId: mailbox.body.id };
}

async function seed(mailboxId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();

  await harness.db.insert(receivedMessage).values({
    id,
    mailboxId,
    messageId: `<${id}@example.test>`,
    imapUid: 42,
    sender: 'someone@example.test',
    subject: 'Seeded',
    folder: 'INBOX',
    ...overrides,
  });

  return id;
}

it('lists a folder from Postgres, newest first, without fetching any body', async () => {
  const { sub, mailboxId } = await newMailbox('msg-list.com');

  await seed(mailboxId, { subject: 'older', receivedAt: new Date(Date.now() - 60_000) });
  await seed(mailboxId, { subject: 'newer' });

  const listed = await call<{ content: MessageSummary[]; totalElements: number }>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages?folder=INBOX`,
  );

  expect(listed.status).toBe(200);
  expect(listed.body.totalElements).toBe(2);
  expect(listed.body.content.map((m) => m.subject)).toEqual(['newer', 'older']);
  expect(imap.fetchBody).not.toHaveBeenCalled();
});

it('separates folders', async () => {
  const { sub, mailboxId } = await newMailbox('msg-folders.com');

  await seed(mailboxId, { folder: 'INBOX' });
  await seed(mailboxId, { folder: 'Spam' });
  await seed(mailboxId, { folder: 'Spam' });

  const spam = await call<{ totalElements: number }>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages?folder=Spam`,
  );
  const inbox = await call<{ totalElements: number }>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages?folder=INBOX`,
  );

  expect(spam.body.totalElements).toBe(2);
  expect(inbox.body.totalElements).toBe(1);
});

it('fetches the body over IMAP and sanitizes it', async () => {
  const { sub, mailboxId } = await newMailbox('msg-read.com');
  const id = await seed(mailboxId);

  const detail = await call<MessageDetail>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages/${id}`,
  );

  expect(detail.status).toBe(200);
  expect(detail.body.html).toContain('Hello');
  expect(detail.body.html).not.toContain('script');
  expect(imap.fetchBody).toHaveBeenCalledWith('erick@msg-read.com', 'INBOX', 42);
});

it('marks a message read on both sides when it is opened', async () => {
  const { sub, mailboxId } = await newMailbox('msg-autoread.com');
  const id = await seed(mailboxId);

  await call(harness, sub, 'GET', `/api/mailboxes/${mailboxId}/messages/${id}`);

  expect(imap.setSeen).toHaveBeenCalledWith('erick@msg-autoread.com', 'INBOX', 42, true);

  const [row] = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(row?.read).toBe(true);
});

it('clears the stale UID when a message moves folder', async () => {
  const { sub, mailboxId } = await newMailbox('msg-move.com');
  const id = await seed(mailboxId);

  const moved = await call(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/messages/${id}/folder`,
    {
      folder: 'Archive',
    },
  );

  expect(moved.status).toBe(204);
  expect(imap.move).toHaveBeenCalledWith('erick@msg-move.com', 'INBOX', 42, 'Archive');

  const [row] = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(row?.folder).toBe('Archive');
  // The UID only means anything inside its old folder.
  expect(row?.imapUid).toBeNull();
});

it('leaves Postgres alone when the IMAP side of a move fails', async () => {
  const { sub, mailboxId } = await newMailbox('msg-move-fail.com');
  const id = await seed(mailboxId);

  imap.move.mockRejectedValueOnce(new Error('imap down'));

  const moved = await call(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/messages/${id}/folder`,
    {
      folder: 'Archive',
    },
  );

  expect(moved.status).toBe(500);

  const [row] = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(row?.folder).toBe('INBOX');
});

it('deletes on both sides', async () => {
  const { sub, mailboxId } = await newMailbox('msg-delete.com');
  const id = await seed(mailboxId);

  const removed = await call(harness, sub, 'DELETE', `/api/mailboxes/${mailboxId}/messages/${id}`);

  expect(removed.status).toBe(204);
  // Delete means Trash, not expunge: only a message already in Trash is destroyed.
  expect(imap.move).toHaveBeenCalled();
  expect(imap.remove).not.toHaveBeenCalled();

  const [row] = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(row?.folder).toBe('Trash');
});

it('destroys a message that was already in Trash', async () => {
  const { sub, mailboxId } = await newMailbox('msg-purge.com');
  const id = await seed(mailboxId, { folder: 'Trash' });

  const removed = await call(harness, sub, 'DELETE', `/api/mailboxes/${mailboxId}/messages/${id}`);

  expect(removed.status).toBe(204);
  expect(imap.remove).toHaveBeenCalled();

  const rows = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(rows).toHaveLength(0);
});

it("answers 404 for messages in another account's mailbox", async () => {
  const owner = await newMailbox('msg-private.com');
  const stranger = await harness.newAccount();
  const id = await seed(owner.mailboxId);

  const read = await call(
    harness,
    stranger.sub,
    'GET',
    `/api/mailboxes/${owner.mailboxId}/messages/${id}`,
  );
  const listed = await call(
    harness,
    stranger.sub,
    'GET',
    `/api/mailboxes/${owner.mailboxId}/messages`,
  );

  expect([read.status, listed.status]).toEqual([404, 404]);
});

it('refuses to send from an unverified domain', async () => {
  const { sub, mailboxId } = await newMailbox('msg-unverified.com', false);

  const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/messages`, {
    to: ['someone@example.test'],
    subject: 'Nope',
    text: 'body',
  });

  expect(result.status).toBe(403);
});

it('refuses a send once the warmup cap is spent, before reaching the MTA', async () => {
  const { sub, mailboxId } = await newMailbox('msg-capped.com');
  const service = harness.app.get(MessageService);
  const send = vi.spyOn(service, 'send');

  const body = { to: ['someone@example.test'], subject: 'x', text: 'y' };

  // Day one of the curve allows 20; the transport is never reachable in tests, so the
  // assertion is that the 21st is refused by the cap rather than by a connection error.
  const statuses: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/messages`, body);
    statuses.push(result.status);
  }

  expect(statuses[20]).toBe(429);
  expect(send).toHaveBeenCalled();
});

it('validates recipients', async () => {
  const { sub, mailboxId } = await newMailbox('msg-validate.com');

  for (const body of [
    { to: [], subject: 'x', text: 'y' },
    { to: ['not-an-address'], subject: 'x', text: 'y' },
  ]) {
    const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/messages`, body);

    expect(result.status, JSON.stringify(body)).toBe(400);
  }
});
