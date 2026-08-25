import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain, receivedMessage } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import type { MailboxResponse } from '../mailboxes/dto';
import { ImapClient } from '../messages/imap.client';
import type { RuleResponse } from '../rules/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { FolderResponse } from './dto';

let harness: TestHarness;
// Stands in for Dovecot: the folder set the server would report, with the separator and
// SPECIAL-USE flags a real server sends.
let tree: { path: string; delimiter: string; specialUse: string | null }[];
let delimiter: string;

beforeAll(async () => {
  harness = await startTestApp();

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);

  const client = harness.app.get(ImapClient);
  vi.spyOn(client, 'listFolders').mockImplementation(() => Promise.resolve([...tree]));
  vi.spyOn(client, 'createFolder').mockImplementation((_address, path) => {
    tree.push({ path, delimiter, specialUse: null });

    return Promise.resolve();
  });
  vi.spyOn(client, 'renameFolder').mockImplementation((_address, path, target) => {
    tree = tree.map((row) => (row.path === path ? { ...row, path: target } : row));

    return Promise.resolve();
  });
  vi.spyOn(client, 'deleteFolder').mockImplementation((_address, path) => {
    tree = tree.filter((row) => row.path !== path && !row.path.startsWith(`${path}${delimiter}`));

    return Promise.resolve();
  });
});

beforeEach(() => {
  delimiter = '/';
  tree = [
    { path: 'INBOX', delimiter, specialUse: null },
    { path: 'Sent', delimiter, specialUse: '\\Sent' },
    { path: 'Trash', delimiter, specialUse: '\\Trash' },
  ];
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

it('creates a folder that is visible while it is still empty', async () => {
  const { sub, mailboxId } = await newMailbox('folder-one.test');

  const created = await call<FolderResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/folders`,
    { name: 'Clientes' },
  );

  expect(created.status).toBe(201);
  expect(created.body.path).toBe('Clientes');
  expect(created.body.total).toBe(0);

  // The whole point: the old listing came from the message rows, so a folder with nothing
  // in it could not be seen or pointed a rule at.
  const listed = await call<FolderResponse[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/folders`,
  );

  expect(listed.body.map((row) => row.path)).toContain('Clientes');
});

it('nests a folder under a parent', async () => {
  const { sub, mailboxId } = await newMailbox('folder-two.test');

  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, { name: 'Financeiro' });
  const child = await call<FolderResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/folders`,
    { name: 'Notas', parent: 'Financeiro' },
  );

  expect(child.body.path).toBe('Financeiro/Notas');
  expect(child.body.parent).toBe('Financeiro');
});

it('refuses a name carrying a path separator', async () => {
  const { sub, mailboxId } = await newMailbox('folder-three.test');

  const created = await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, {
    name: 'a/b',
  });

  expect(created.status).toBe(400);
});

it('refuses to rename or delete a folder the mail server owns', async () => {
  const { sub, mailboxId } = await newMailbox('folder-four.test');

  const renamed = await call(harness, sub, 'PUT', `/api/mailboxes/${mailboxId}/folders/rename`, {
    path: 'INBOX',
    name: 'Entrada',
  });
  const deleted = await call(harness, sub, 'DELETE', `/api/mailboxes/${mailboxId}/folders`, {
    path: 'Trash',
  });

  expect(renamed.status).toBe(403);
  expect(deleted.status).toBe(403);
});

it('carries the messages along when a folder is renamed', async () => {
  const { sub, mailboxId } = await newMailbox('folder-five.test');

  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, { name: 'Antiga' });
  await harness.db.insert(receivedMessage).values({
    id: randomUUID(),
    mailboxId,
    messageId: `<${randomUUID()}@folder-five.test>`,
    sender: 'quem@example.test',
    subject: 'oi',
    folder: 'Antiga',
  });

  const renamed = await call<FolderResponse>(
    harness,
    sub,
    'PUT',
    `/api/mailboxes/${mailboxId}/folders/rename`,
    { path: 'Antiga', name: 'Nova' },
  );

  expect(renamed.body.path).toBe('Nova');
  expect(renamed.body.total).toBe(1);
});

it('refuses to delete a folder a rule files into', async () => {
  const { sub, mailboxId } = await newMailbox('folder-six.test');

  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, { name: 'Clientes' });
  await call<RuleResponse>(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/rules`, {
    conditionField: 'sender',
    conditionOperator: 'contains',
    conditionValue: '@empresa.com',
    action: 'move_to',
    targetFolder: 'Clientes',
  });

  const deleted = await call<{ message: string }>(
    harness,
    sub,
    'DELETE',
    `/api/mailboxes/${mailboxId}/folders`,
    { path: 'Clientes' },
  );

  // Deleting it would leave the Sieve script filing into nothing, and the mail would land
  // back in INBOX with no explanation.
  expect(deleted.status).toBe(409);
  expect(deleted.body.message).toContain('rule');
});

it('reports the rule count on the folder it belongs to', async () => {
  const { sub, mailboxId } = await newMailbox('folder-seven.test');

  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, { name: 'Clientes' });
  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/rules`, {
    conditionField: 'sender',
    conditionOperator: 'contains',
    conditionValue: '@empresa.com',
    action: 'move_to',
    targetFolder: 'Clientes',
  });

  const listed = await call<FolderResponse[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/folders`,
  );

  expect(listed.body.find((row) => row.path === 'Clientes')?.ruleCount).toBe(1);
});

it('nests with the separator the server reports, not an assumed one', async () => {
  // Dovecot on Maildir++ hands out '.', and building the path with '/' created a folder
  // with a literal slash in its name instead of a child.
  delimiter = '.';
  tree = [{ path: 'INBOX', delimiter, specialUse: null }];

  const { sub, mailboxId } = await newMailbox('folder-eight.test');

  await call(harness, sub, 'POST', `/api/mailboxes/${mailboxId}/folders`, { name: 'Financeiro' });
  const child = await call<FolderResponse>(
    harness,
    sub,
    'POST',
    `/api/mailboxes/${mailboxId}/folders`,
    { name: 'Notas', parent: 'Financeiro' },
  );

  expect(child.body.path).toBe('Financeiro.Notas');
  expect(child.body.parent).toBe('Financeiro');
  expect(child.body.name).toBe('Notas');
});

it('treats a folder the server flagged as special as a system folder', async () => {
  const { sub, mailboxId } = await newMailbox('folder-nine.test');

  // Named like a user folder, but carrying \Archive: the name alone would misjudge it.
  tree.push({ path: 'Arquivo', delimiter, specialUse: '\\Archive' });

  const listed = await call<FolderResponse[]>(
    harness,
    sub,
    'GET',
    `/api/mailboxes/${mailboxId}/folders`,
  );

  expect(listed.body.find((row) => row.path === 'Arquivo')?.system).toBe(true);

  const deleted = await call(harness, sub, 'DELETE', `/api/mailboxes/${mailboxId}/folders`, {
    path: 'Arquivo',
  });

  expect(deleted.status).toBe(403);
});
