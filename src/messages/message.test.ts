import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { type MockInstance, afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain, receivedMessage } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { BulkResult, MessageDetail, MessageSummary } from './dto';
import { ImapClient } from './imap.client';
import { MessageService } from './message.service';

let harness: TestHarness;
let imap: {
  fetchBody: MockInstance<ImapClient['fetchBody']>;
  fetchBodies: MockInstance<ImapClient['fetchBodies']>;
  setSeen: MockInstance<ImapClient['setSeen']>;
  move: MockInstance<ImapClient['move']>;
  remove: MockInstance<ImapClient['remove']>;
  append: MockInstance<ImapClient['append']>;
  listMessages: MockInstance<ImapClient['listMessages']>;
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
      to: ['erick@example.test'],
      cc: [],
      attachments: [],
    }),
    fetchBodies: vi.spyOn(client, 'fetchBodies').mockResolvedValue(new Map()),
    setSeen: vi.spyOn(client, 'setSeen').mockResolvedValue(undefined),
    move: vi.spyOn(client, 'move').mockResolvedValue(undefined),
    remove: vi.spyOn(client, 'remove').mockResolvedValue(undefined),
    append: vi.spyOn(client, 'append').mockResolvedValue(undefined),
    listMessages: vi
      .spyOn(client, 'listMessages')
      .mockRejectedValue(new Error('imap unavailable in tests')),
  };

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
  imap.fetchBodies.mockClear();
  imap.setSeen.mockClear();
  imap.move.mockClear();
  imap.remove.mockClear();
  imap.append.mockClear();
  imap.listMessages.mockClear();
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

it('drops the projection row when a message moves folder', async () => {
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

  const rows = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(rows).toHaveLength(0);
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
  expect(imap.move).toHaveBeenCalled();
  expect(imap.remove).not.toHaveBeenCalled();

  const rows = await harness.db.select().from(receivedMessage).where(eq(receivedMessage.id, id));

  expect(rows).toHaveLength(0);
});

it('trashes a message whose Message-ID is already in Trash', async () => {
  const { sub, mailboxId } = await newMailbox('msg-dupe-trash.com');
  const shared = `<${randomUUID()}@example.test>`;

  await seed(mailboxId, { messageId: shared, folder: 'Trash' });
  const id = await seed(mailboxId, { messageId: shared, folder: 'Sent' });

  const removed = await call(harness, sub, 'DELETE', `/api/mailboxes/${mailboxId}/messages/${id}`);

  expect(removed.status).toBe(204);
});

it('collapses two copies of one Message-ID in a folder instead of failing the listing', async () => {
  const { sub, mailboxId } = await newMailbox('msg-dupes.com');
  const shared = '<same-id@example.test>';

  imap.listMessages.mockResolvedValueOnce([
    {
      uid: 7,
      messageId: shared,
      from: 'a@example.test',
      to: [],
      cc: [],
      subject: 'older',
      inReplyTo: null,
      date: new Date(Date.now() - 60_000).toISOString(),
      seen: false,
    },
    {
      uid: 9,
      messageId: shared,
      from: 'a@example.test',
      to: [],
      cc: [],
      subject: 'newer',
      inReplyTo: null,
      date: new Date().toISOString(),
      seen: false,
    },
  ]);

  const listed = await call<{ content: MessageSummary[]; totalElements: number }>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages?folder=Trash`,
  );

  expect(listed.status).toBe(200);
  expect(listed.body.totalElements).toBe(1);
  expect(listed.body.content[0]?.subject).toBe('newer');
});

it('mirrors a reply into the conversation its parent belongs to', async () => {
  const { sub, mailboxId } = await newMailbox('msg-thread-sync.com');
  const root = '<root@example.test>';

  await seed(mailboxId, { messageId: root, threadId: root, folder: 'INBOX' });

  imap.listMessages.mockResolvedValueOnce([
    {
      uid: 3,
      messageId: '<reply@example.test>',
      from: 'a@example.test',
      to: [],
      cc: [],
      subject: 'Re: hi',
      inReplyTo: root,
      date: new Date().toISOString(),
      seen: true,
    },
  ]);

  await call(harness, sub, 'GET', `/api/mailboxes/${mailboxId}/messages?folder=Archive`);

  const [row] = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.messageId, '<reply@example.test>'));

  expect(row?.threadId).toBe(root);
});

it('returns the whole conversation with bodies, oldest first', async () => {
  const { sub, mailboxId } = await newMailbox('msg-thread.com');
  const root = '<conv@example.test>';

  const first = await seed(mailboxId, {
    messageId: root,
    threadId: root,
    subject: 'first',
    receivedAt: new Date(Date.now() - 60_000),
  });
  const second = await seed(mailboxId, {
    messageId: '<conv-2@example.test>',
    threadId: root,
    subject: 'second',
  });

  imap.fetchBodies.mockResolvedValueOnce(
    new Map([
      [42, { html: null, text: 'body', to: ['erick@msg-thread.com'], cc: [], attachments: [] }],
    ]),
  );

  const thread = await call<MessageDetail[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages/${second}/thread`,
  );

  expect(thread.status).toBe(200);
  expect(thread.body.map((row) => row.id)).toEqual([first, second]);
  expect(thread.body.map((row) => row.text)).toEqual(['body', 'body']);
  expect(imap.fetchBodies).toHaveBeenCalledTimes(1);
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

  const statuses: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    const result = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/messages`, body);
    statuses.push(result.status);
  }

  expect(statuses[20]).toBe(429);
  expect(send).toHaveBeenCalled();
});

it('lists a message sent to yourself once, not once per folder', async () => {
  const { sub, mailboxId } = await newMailbox('msg-thread-dupe.com');
  const root = '<self@example.test>';

  const inbox = await seed(mailboxId, {
    messageId: root,
    threadId: root,
    folder: 'INBOX',
    subject: 'to myself',
  });
  await seed(mailboxId, { messageId: root, threadId: root, folder: 'Sent', subject: 'to myself' });

  const thread = await call<MessageDetail[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/messages/${inbox}/thread`,
  );

  expect(thread.status).toBe(200);
  expect(thread.body).toHaveLength(1);
  expect(thread.body[0]?.id).toBe(inbox);
});

it('saves a draft that has no recipient yet', async () => {
  const { sub, mailboxId } = await newMailbox('msg-draft.com');

  const saved = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/messages/drafts`, {
    subject: 'Half written',
    text: 'to be continued',
  });

  expect(saved.status).toBe(204);
  expect(imap.append).toHaveBeenCalled();
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

it('marks a batch of messages read in one request', async () => {
  const { sub, mailboxId } = await newMailbox('msg-bulk-read.com');
  const ids = [await seed(mailboxId), await seed(mailboxId), await seed(mailboxId)];

  const result = await call<BulkResult>(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/messages/bulk/read`,
    { ids, read: true },
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ processed: ids, failed: [] });
  expect(imap.setSeen).toHaveBeenCalledTimes(3);

  const rows = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, mailboxId));

  expect(rows.every((row) => row.read)).toBe(true);
});

it('moves a batch of messages in one request', async () => {
  const { sub, mailboxId } = await newMailbox('msg-bulk-move.com');
  const ids = [await seed(mailboxId), await seed(mailboxId)];

  const result = await call<BulkResult>(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/messages/bulk/folder`,
    { ids, folder: 'Archive' },
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ processed: ids, failed: [] });
  expect(imap.move).toHaveBeenCalledTimes(2);
  expect(imap.move).toHaveBeenLastCalledWith('erick@msg-bulk-move.com', 'INBOX', 42, 'Archive');

  const rows = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, mailboxId));

  expect(rows).toHaveLength(0);
});

it('deletes a batch of messages in one request', async () => {
  const { sub, mailboxId } = await newMailbox('msg-bulk-delete.com');
  const ids = [await seed(mailboxId), await seed(mailboxId, { folder: 'Trash' })];

  const result = await call<BulkResult>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/messages/bulk/delete`,
    { ids },
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ processed: ids, failed: [] });
  expect(imap.move).toHaveBeenCalledTimes(1);
  expect(imap.remove).toHaveBeenCalledTimes(1);

  const rows = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.mailboxId, mailboxId));

  expect(rows).toHaveLength(0);
});

it('carries on past an id belonging to another mailbox and reports it as failed', async () => {
  const { sub, mailboxId } = await newMailbox('msg-bulk-mixed.com');
  const stranger = await newMailbox('msg-bulk-stranger.com');
  const mine = [await seed(mailboxId), await seed(mailboxId)];
  const theirs = await seed(stranger.mailboxId);

  const result = await call<BulkResult>(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/messages/bulk/read`,
    { ids: [mine[0], theirs, mine[1]], read: true },
  );

  expect(result.status).toBe(200);
  expect(result.body.processed).toEqual(mine);
  expect(result.body.failed).toEqual([theirs]);

  const [untouched] = await harness.db
    .select()
    .from(receivedMessage)
    .where(eq(receivedMessage.id, theirs));

  expect(untouched?.read).toBe(false);
});

it('rejects a batch with no ids at all', async () => {
  const { sub, mailboxId } = await newMailbox('msg-bulk-empty.com');

  const result = await call(harness, sub, 'PUT', `/api/mailboxes/${mailboxId}/messages/bulk/read`, {
    ids: [],
    read: true,
  });

  expect(result.status).toBe(400);
});
