import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended'] as const;
export const SENT_MESSAGE_STATUSES = ['delivered', 'bounced', 'pending'] as const;
export const MANUAL_CLASSIFICATIONS = ['spam', 'not_spam'] as const;
export const RULE_CONDITION_FIELDS = ['sender', 'subject', 'recipient'] as const;
export const RULE_CONDITION_OPERATORS = ['contains', 'equals', 'starts_with', 'ends_with'] as const;
export const RULE_ACTIONS = ['move_to', 'mark_read', 'forward', 'discard'] as const;
export const FEEDBACK_PROVIDERS = ['google', 'microsoft'] as const;
export const DOMAIN_KINDS = ['platform', 'custom'] as const;

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    keycloakSub: uuid('keycloak_sub').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 255 }),
    plan: varchar('plan', { length: 32 }).notNull().default('free'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_account_keycloak_sub').on(table.keycloakSub),
    check('account_status_check', sql`${table.status} IN ('pending', 'active', 'suspended')`),
  ],
);

export const domain = pgTable(
  'domain',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').references(() => account.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull().default('custom'),
    name: varchar('name', { length: 253 }).notNull(),
    dkimSelector: varchar('dkim_selector', { length: 63 }).notNull().default('stampyx'),
    dkimPrivateKey: text('dkim_private_key').notNull(),
    verificationToken: varchar('verification_token', { length: 128 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_domain_name').on(table.name),
    index('idx_domain_account_id').on(table.accountId, table.name),
    check('domain_kind_check', sql`${table.kind} IN ('platform', 'custom')`),
    check(
      'domain_account_check',
      sql`${table.kind} = 'platform' OR ${table.accountId} IS NOT NULL`,
    ),
  ],
);

export const mailbox = pgTable(
  'mailbox',
  {
    id: uuid('id').primaryKey(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domain.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    localPart: varchar('local_part', { length: 64 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    quotaMb: integer('quota_mb').notNull().default(1024),
    active: boolean('active').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_mailbox_domain_local_part').on(table.domainId, table.localPart),
    index('idx_mailbox_account_id').on(table.accountId),
  ],
);

export const mailboxSession = pgTable(
  'mailbox_session',
  {
    id: uuid('id').primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_mailbox_session_token').on(table.refreshTokenHash),
    index('idx_mailbox_session_mailbox').on(table.mailboxId),
  ],
);

export const alias = pgTable(
  'alias',
  {
    id: uuid('id').primaryKey(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domain.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 320 }).notNull(),
    destination: varchar('destination', { length: 320 }).notNull(),
  },
  (table) => [uniqueIndex('uq_alias_domain_source').on(table.domainId, table.source)],
);

export const sentMessage = pgTable(
  'sent_message',
  {
    id: uuid('id').primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 998 }).notNull(),
    recipient: varchar('recipient', { length: 320 }).notNull(),
    subject: text('subject'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    smtpResponseCode: varchar('smtp_response_code', { length: 32 }),
  },
  (table) => [
    index('idx_sent_message_mailbox').on(table.mailboxId, table.sentAt.desc()),
    uniqueIndex('uq_sent_message_mailbox_message_recipient').on(
      table.mailboxId,
      table.messageId,
      table.recipient,
    ),
    check('sent_message_status_check', sql`${table.status} IN ('delivered', 'bounced', 'pending')`),
  ],
);

export const receivedMessage = pgTable(
  'received_message',
  {
    id: uuid('id').primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 998 }).notNull(),
    imapUid: bigint('imap_uid', { mode: 'number' }),
    sender: varchar('sender', { length: 320 }).notNull(),
    recipient: varchar('recipient', { length: 320 }),
    subject: text('subject'),
    inReplyTo: varchar('in_reply_to', { length: 998 }),
    threadId: varchar('thread_id', { length: 998 }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    folder: varchar('folder', { length: 255 }).notNull().default('INBOX'),
    spamScore: integer('spam_score'),
    manualClassification: varchar('manual_classification', { length: 16 }),
    read: boolean('read').notNull().default(false),
  },
  (table) => [
    index('idx_received_message_mailbox_folder').on(
      table.mailboxId,
      table.folder,
      table.receivedAt.desc(),
    ),
    uniqueIndex('uq_received_message_mailbox_folder_message_id').on(
      table.mailboxId,
      table.folder,
      table.messageId,
    ),
    index('idx_received_message_thread').on(table.mailboxId, table.threadId),
    check(
      'received_message_manual_classification_check',
      sql`${table.manualClassification} IS NULL OR ${table.manualClassification} IN ('spam', 'not_spam')`,
    ),
  ],
);

export const attachment = pgTable(
  'attachment',
  {
    id: uuid('id').primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 998 }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_attachment_mailbox_message').on(table.mailboxId, table.messageId)],
);

export const folderRule = pgTable(
  'folder_rule',
  {
    id: uuid('id').primaryKey(),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailbox.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    active: boolean('active').notNull().default(true),
    conditionField: varchar('condition_field', { length: 16 }).notNull(),
    conditionOperator: varchar('condition_operator', { length: 16 }).notNull(),
    conditionValue: varchar('condition_value', { length: 500 }).notNull(),
    action: varchar('action', { length: 16 }).notNull(),
    targetFolder: varchar('target_folder', { length: 255 }),
  },
  (table) => [
    index('idx_folder_rule_mailbox_position').on(table.mailboxId, table.position),
    check(
      'folder_rule_condition_field_check',
      sql`${table.conditionField} IN ('sender', 'subject', 'recipient')`,
    ),
    check(
      'folder_rule_condition_operator_check',
      sql`${table.conditionOperator} IN ('contains', 'equals', 'starts_with', 'ends_with')`,
    ),
    check(
      'folder_rule_action_check',
      sql`${table.action} IN ('move_to', 'mark_read', 'forward', 'discard')`,
    ),
    check(
      'folder_rule_target_folder_check',
      sql`${table.action} <> 'move_to' OR ${table.targetFolder} IS NOT NULL`,
    ),
  ],
);

export const warmupPlan = pgTable(
  'warmup_plan',
  {
    id: uuid('id').primaryKey(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domain.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    targetVolume: integer('target_volume').notNull(),
    actualVolume: integer('actual_volume').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('uq_warmup_plan_domain_day').on(table.domainId, table.day)],
);

export const sendCounter = pgTable(
  'send_counter',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    sent: integer('sent').notNull().default(0),
  },
  (table) => [uniqueIndex('uq_send_counter_account_day').on(table.accountId, table.day)],
);

export const providerFeedback = pgTable(
  'provider_feedback',
  {
    id: uuid('id').primaryKey(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => domain.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).notNull(),
    date: date('date').notNull(),
    reputation: varchar('reputation', { length: 32 }),
    spamRate: integer('spam_rate'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_provider_feedback_domain_provider_date').on(
      table.domainId,
      table.provider,
      table.date,
    ),
    check('provider_feedback_provider_check', sql`${table.provider} IN ('google', 'microsoft')`),
  ],
);

export const vPostfixDomains = pgView('v_postfix_domains', {
  name: varchar('name', { length: 253 }).notNull(),
}).existing();

export const vDovecotUsers = pgView('v_dovecot_users', {
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  quotaMb: integer('quota_mb').notNull(),
}).existing();

export const vPostfixSenders = pgView('v_postfix_senders', {
  email: text('email').notNull(),
  owner: text('owner').notNull(),
}).existing();

export type Account = typeof account.$inferSelect;
export type Domain = typeof domain.$inferSelect;
export type Mailbox = typeof mailbox.$inferSelect;
export type MailboxSession = typeof mailboxSession.$inferSelect;
export type Alias = typeof alias.$inferSelect;
export type SentMessage = typeof sentMessage.$inferSelect;
export type ReceivedMessage = typeof receivedMessage.$inferSelect;
export type Attachment = typeof attachment.$inferSelect;
export type FolderRule = typeof folderRule.$inferSelect;
export type WarmupPlan = typeof warmupPlan.$inferSelect;
export type SendCounter = typeof sendCounter.$inferSelect;
export type ProviderFeedback = typeof providerFeedback.$inferSelect;
