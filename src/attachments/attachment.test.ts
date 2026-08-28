import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { attachment, domain } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { AttachmentResponse } from './dto';

let harness: TestHarness;
let store: string;

beforeAll(async () => {
  store = await mkdtemp(path.join(tmpdir(), 'stampyx-attachments-'));
  harness = await startTestApp({
    config: { MAIL_ATTACHMENTS_DIR: store, MAIL_MAX_ATTACHMENT_BYTES: 2048 },
  });

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

async function upload(sub: string, mailboxId: string, fileName: string, bytes: number) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes).fill(65)]), fileName);

  const response = await fetch(`${harness.url}/api/mailboxes/${mailboxId}/attachments`, {
    method: 'POST',
    headers: { 'x-test-owner': sub },
    body: form,
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text === '' ? undefined : JSON.parse(text)) as AttachmentResponse,
  };
}

it('stores an upload under its own id, never under the name the sender typed', async () => {
  const { sub, mailboxId } = await newMailbox('att-one.test');

  const created = await upload(sub, mailboxId, '../../escape.pdf', 64);

  expect(created.status).toBe(201);
  expect(created.body.sizeBytes).toBe(64);
  expect(created.body.fileName).toBe('escape.pdf');

  const [row] = await harness.db
    .select()
    .from(attachment)
    .where(eq(attachment.id, created.body.id));

  expect(row?.storagePath).toBe(path.join(store, mailboxId, created.body.id));
  await expect(readFile(row?.storagePath ?? '')).resolves.toHaveLength(64);
});

it('refuses an upload that would push the draft over the ceiling', async () => {
  const { sub, mailboxId } = await newMailbox('att-two.test');

  const first = await upload(sub, mailboxId, 'a.bin', 1500);
  const second = await upload(sub, mailboxId, 'b.bin', 1000);

  expect(first.status).toBe(201);
  expect(second.status).toBe(413);
});

it('leaves an upload unbound until the message actually goes out', async () => {
  const { sub, mailboxId } = await newMailbox('att-three.test');

  const created = await upload(sub, mailboxId, 'anexo.pdf', 32);

  const [row] = await harness.db
    .select()
    .from(attachment)
    .where(eq(attachment.id, created.body.id));

  expect(row?.messageId).toBeNull();

  const listed = await call<AttachmentResponse[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/attachments`,
  );

  expect(listed.body).toHaveLength(1);
});

it('drops a draft and its bytes', async () => {
  const { sub, mailboxId } = await newMailbox('att-four.test');
  const created = await upload(sub, mailboxId, 'temp.bin', 16);

  const removed = await call<unknown>(
    harness,
    sub,
    'DELETE',
    `/api/mailboxes/${mailboxId}/attachments/${created.body.id}`,
  );

  expect(removed.status).toBe(204);

  const rows = await harness.db.select().from(attachment).where(eq(attachment.id, created.body.id));

  expect(rows).toHaveLength(0);
});

it("refuses to send with another mailbox's attachment", async () => {
  const mine = await newMailbox('att-five.test');
  const theirs = await newMailbox('att-six.test');

  const stolen = await upload(theirs.sub, theirs.mailboxId, 'alheio.pdf', 16);

  const sent = await call<unknown>(
    harness,
    mine.sub,
    'POST',
    `/api/mailboxes/${mine.mailboxId}/messages`,
    {
      to: ['alguem@example.test'],
      subject: 'oi',
      text: 'oi',
      attachmentIds: [stolen.body.id],
    },
  );

  expect(sent.status).toBe(400);
});
