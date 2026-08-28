import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import type { FolderRule } from '../database/schema';
import { generateSieve } from './sieve';

const OPTIONS = { notifyScript: 'notify-mail-received.sh', junkFolder: 'Junk' };

function rule(overrides: Partial<FolderRule> = {}): FolderRule {
  return {
    id: randomUUID(),
    mailboxId: randomUUID(),
    position: 1,
    active: true,
    conditionField: 'sender',
    conditionOperator: 'contains',
    conditionValue: '@hetzner.com',
    action: 'move_to',
    targetFolder: 'Infra',
    ...overrides,
  };
}

it('keeps spam first and user rules after it', () => {
  const script = generateSieve([rule()], OPTIONS);

  const spam = script.indexOf('X-Spam-Flag');
  const user = script.indexOf('@hetzner.com');

  expect(spam).toBeGreaterThan(-1);
  expect(spam).toBeLessThan(user);
});

it('reports every branch that stops, naming the folder it filed into', () => {
  const script = generateSieve([rule({ action: 'move_to', targetFolder: 'Work' })], OPTIONS);

  expect(script).toContain(
    'fileinto :create "Junk";\n    pipe :copy "notify-mail-received.sh" ["Junk"];',
  );
  expect(script).toContain('fileinto "Work";\n    pipe :copy "notify-mail-received.sh" ["Work"];');
  expect(script).toContain('pipe :copy "notify-mail-received.sh" ["INBOX"];');
});

it('emits rules in position order, not insertion order', () => {
  const script = generateSieve(
    [
      rule({ position: 3, conditionValue: 'third' }),
      rule({ position: 1, conditionValue: 'first' }),
      rule({ position: 2, conditionValue: 'second' }),
    ],
    OPTIONS,
  );

  expect(script.indexOf('first')).toBeLessThan(script.indexOf('second'));
  expect(script.indexOf('second')).toBeLessThan(script.indexOf('third'));
});

it('omits inactive rules', () => {
  const script = generateSieve([rule({ active: false, conditionValue: 'disabled' })], OPTIONS);

  expect(script).not.toContain('disabled');
});

it('maps each operator to the right Sieve test', () => {
  const cases = [
    ['contains', 'header :contains "from" "acme.com"'],
    ['equals', 'header :is "from" "acme.com"'],
    ['starts_with', 'header :matches "from" "acme.com*"'],
    ['ends_with', 'header :matches "from" "*acme.com"'],
  ] as const;

  for (const [operator, expected] of cases) {
    const script = generateSieve(
      [rule({ conditionOperator: operator, conditionValue: 'acme.com' })],
      OPTIONS,
    );

    expect(script, operator).toContain(expected);
  }
});

it('maps each field to the right header', () => {
  for (const [field, header] of [
    ['sender', '"from"'],
    ['subject', '"subject"'],
    ['recipient', '"to"'],
  ] as const) {
    const script = generateSieve([rule({ conditionField: field })], OPTIONS);

    expect(script, field).toContain(`header :contains ${header}`);
  }
});

it('stops only after it has reported where the message went', () => {
  const script = generateSieve([rule({ action: 'move_to', targetFolder: 'Work' })], OPTIONS);

  expect(script).toContain(
    'fileinto "Work";\n    pipe :copy "notify-mail-received.sh" ["Work"];\n    stop;',
  );
});

it('reports nothing for a rule that stores nothing locally', () => {
  const forwarded = generateSieve([rule({ action: 'forward' })], OPTIONS);
  const discarded = generateSieve([rule({ action: 'discard' })], OPTIONS);

  expect(forwarded).not.toMatch(/redirect[^}]*pipe :copy/);
  expect(discarded).not.toMatch(/discard;[^}]*pipe :copy/);
});

it('does not stop after mark_read, which is not a move', () => {
  const script = generateSieve([rule({ action: 'mark_read' })], OPTIONS);

  expect(script).toContain('setflag "\\\\Seen";');
  expect(script).not.toMatch(/setflag "\\\\Seen";\n {4}stop;/);
});

it('escapes quotes and backslashes so a value cannot close the string literal', () => {
  const script = generateSieve(
    [rule({ conditionValue: 'evil" ; discard; if header :contains "from" "x' })],
    OPTIONS,
  );

  expect(script).toContain('\\"');
  expect(script).not.toMatch(/^\s*discard;$/m);
});

it('escapes a backslash before the escaping of a quote can be undone', () => {
  const script = generateSieve([rule({ conditionValue: 'trailing\\' })], OPTIONS);

  expect(script).toContain('"trailing\\\\"');
});

it('escapes wildcards in :matches so a literal asterisk is not a pattern', () => {
  const script = generateSieve(
    [rule({ conditionOperator: 'starts_with', conditionValue: 'a*b?c' })],
    OPTIONS,
  );

  expect(script).toContain('"a\\*b\\?c*"');
});

it('escapes a folder name as carefully as a condition value', () => {
  const script = generateSieve([rule({ targetFolder: 'Odd"Name' })], OPTIONS);

  expect(script).toContain('fileinto "Odd\\"Name";');
});

it('skips a move_to with no target rather than emitting an uncompilable script', () => {
  const script = generateSieve(
    [rule({ action: 'move_to', targetFolder: null, conditionValue: 'orphan' })],
    OPTIONS,
  );

  expect(script).not.toContain('orphan');
  expect(script).not.toContain('fileinto ;');
});

it('requires copy, which the :copy tag on pipe needs to compile', () => {
  expect(generateSieve([], OPTIONS)).toContain(
    'require ["copy", "fileinto", "imap4flags", "mailbox", "vnd.dovecot.pipe"];',
  );
});

it('still produces a valid script when there are no rules at all', () => {
  const script = generateSieve([], OPTIONS);

  expect(script).toContain('require [');
  expect(script).toContain('X-Spam-Flag');
  expect(script).toContain('pipe :copy "notify-mail-received.sh" ["INBOX"];');
});

it('files spam into the configured junk mailbox and requires the extension that creates it', () => {
  const script = generateSieve([], { ...OPTIONS, junkFolder: 'Lixo' });

  expect(script).toContain('"mailbox"');
  expect(script).toContain('fileinto :create "Lixo";');
  expect(script).toContain('pipe :copy "notify-mail-received.sh" ["Lixo"];');
  expect(script).not.toContain('"Spam"');
});
