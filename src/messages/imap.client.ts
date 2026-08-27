import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { type ParsedMail, simpleParser } from 'mailparser';

import { CONFIG, type Config } from '../config';

export interface FetchedAttachment {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export interface ParsedBody {
  readonly html: string | null;
  readonly text: string | null;
  // The projection does not keep recipients; reopening a draft needs them from the message itself.
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly attachments: readonly {
    filename: string;
    contentType: string;
    size: number;
  }[];
}

// What a folder holds right now without reading a message: STATUS is what keeps a badge
// honest for a folder nobody has opened.
export interface FolderStatus {
  readonly total: number;
  readonly unread: number;
}

// The server decides both; a hard-coded separator breaks silently on another namespace.
export interface ImapFolder {
  readonly path: string;
  readonly delimiter: string;
  readonly specialUse: string | null;
}

export interface ImapMessage {
  readonly uid: number;
  readonly messageId: string;
  readonly from: string;
  // Needed to reopen a draft: the composer has to put the recipients back in the fields.
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string | null;
  // The parent this message answers, so a mirrored conversation keeps its shape.
  readonly inReplyTo: string | null;
  readonly date: string;
  readonly seen: boolean;
}

export interface ImapOperations {
  fetchBody(address: string, folder: string, uid: number): Promise<ParsedBody | null>;
  fetchBodies(
    address: string,
    folder: string,
    uids: readonly number[],
  ): Promise<Map<number, ParsedBody>>;
  statusOf(address: string, paths: readonly string[]): Promise<Map<string, FolderStatus>>;
  fetchAttachment(
    address: string,
    folder: string,
    uid: number,
    index: number,
  ): Promise<FetchedAttachment | null>;
  findUid(address: string, folder: string, messageId: string): Promise<number | null>;
  listMessages(address: string, folder: string): Promise<ImapMessage[]>;
  move(address: string, folder: string, uid: number, target: string): Promise<void>;
  setSeen(address: string, folder: string, uid: number, seen: boolean): Promise<void>;
  remove(address: string, folder: string, uid: number): Promise<void>;
  listFolders(address: string): Promise<ImapFolder[]>;
  createFolder(address: string, path: string): Promise<void>;
  append(address: string, folder: string, raw: Buffer, flags: string[]): Promise<void>;
  renameFolder(address: string, path: string, target: string): Promise<void>;
  deleteFolder(address: string, path: string): Promise<void>;
}

@Injectable()
export class ImapClient implements ImapOperations {
  private readonly logger = new Logger(ImapClient.name);

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async fetchBody(address: string, folder: string, uid: number): Promise<ParsedBody | null> {
    return this.withMailbox(address, folder, async (client) => {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });

      if (message === false || message.source === undefined) {
        return null;
      }

      const parsed = await simpleParser(message.source);

      return toParsedBody(parsed);
    });
  }

  // One connection for the conversation: message by message opened an IMAP session each.
  async fetchBodies(
    address: string,
    folder: string,
    uids: readonly number[],
  ): Promise<Map<number, ParsedBody>> {
    if (uids.length === 0) {
      return new Map();
    }

    return this.withMailbox(address, folder, async (client) => {
      const bodies = new Map<number, ParsedBody>();

      for await (const message of client.fetch(
        uids.join(','),
        { uid: true, source: true },
        { uid: true },
      )) {
        if (message.source === undefined) {
          continue;
        }

        bodies.set(message.uid, toParsedBody(await simpleParser(message.source)));
      }

      return bodies;
    });
  }

  // By the server, not the projection, which only knew the last sync of an opened folder.
  async statusOf(address: string, paths: readonly string[]): Promise<Map<string, FolderStatus>> {
    if (paths.length === 0) {
      return new Map();
    }

    return this.connected(address, async (client) => {
      const counts = new Map<string, FolderStatus>();

      for (const path of paths) {
        try {
          const status = await client.status(path, { messages: true, unseen: true });

          counts.set(path, { total: status.messages ?? 0, unread: status.unseen ?? 0 });
        } catch {
          // One uncountable folder must not leave the rest uncounted; the projection stands in for it.
          continue;
        }
      }

      return counts;
    });
  }

  // The list carries names and sizes; the bytes are read from the source, never copied to disk.
  async fetchAttachment(
    address: string,
    folder: string,
    uid: number,
    index: number,
  ): Promise<FetchedAttachment | null> {
    return this.withMailbox(address, folder, async (client) => {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });

      if (message === false || message.source === undefined) {
        return null;
      }

      const parsed = await simpleParser(message.source);
      const found = parsed.attachments[index];

      if (found === undefined) {
        return null;
      }

      return {
        fileName: found.filename ?? 'attachment',
        contentType: found.contentType,
        content: found.content,
      };
    });
  }

  // Sent mail is appended, never delivered, so it never passes the pipe: IMAP is the only source.
  async listMessages(address: string, folder: string): Promise<ImapMessage[]> {
    return this.withMailbox(address, folder, async (client) => {
      const rows: ImapMessage[] = [];

      for await (const message of client.fetch(
        { all: true },
        { uid: true, envelope: true, flags: true },
      )) {
        const envelope = message.envelope;
        const sender = envelope?.from?.[0]?.address ?? envelope?.sender?.[0]?.address ?? '';

        rows.push({
          uid: message.uid,
          messageId: envelope?.messageId ?? '',
          from: sender,
          to: (envelope?.to ?? []).map((entry) => entry.address ?? '').filter((it) => it !== ''),
          cc: (envelope?.cc ?? []).map((entry) => entry.address ?? '').filter((it) => it !== ''),
          subject: envelope?.subject ?? null,
          inReplyTo: envelope?.inReplyTo ?? null,
          date: (envelope?.date ?? new Date()).toISOString(),
          seen: message.flags?.has('\\Seen') ?? false,
        });
      }

      return rows.reverse();
    });
  }

  // Sieve runs before the message has a UID, so every row arrives with imapUid null and the
  // Message-ID is the only handle that exists at both ends.
  async findUid(address: string, folder: string, messageId: string): Promise<number | null> {
    return this.withMailbox(address, folder, async (client) => {
      const found = await client.search({ header: { 'message-id': messageId } }, { uid: true });

      if (found === false || found.length === 0) {
        return null;
      }

      return found[found.length - 1] ?? null;
    });
  }

  async move(address: string, folder: string, uid: number, target: string): Promise<void> {
    await this.withMailbox(address, folder, async (client) => {
      await client.messageMove(String(uid), target, { uid: true });
    });
  }

  async setSeen(address: string, folder: string, uid: number, seen: boolean): Promise<void> {
    await this.withMailbox(address, folder, async (client) => {
      const flags = ['\\Seen'];

      if (seen) {
        await client.messageFlagsAdd(String(uid), flags, { uid: true });
      } else {
        await client.messageFlagsRemove(String(uid), flags, { uid: true });
      }
    });
  }

  async remove(address: string, folder: string, uid: number): Promise<void> {
    await this.withMailbox(address, folder, async (client) => {
      await client.messageDelete(String(uid), { uid: true });
    });
  }

  async listFolders(address: string): Promise<ImapFolder[]> {
    return this.connected(address, async (client) => {
      const list = await client.list();

      return list.map((entry) => ({
        path: entry.path,
        delimiter: entry.delimiter,
        specialUse: entry.specialUse ?? null,
      }));
    });
  }

  private async withMailbox<T>(
    address: string,
    folder: string,
    action: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    return this.connected(address, async (client) => {
      const lock = await client.getMailboxLock(folder);

      try {
        return await action(client);
      } finally {
        lock.release();
      }
    });
  }

  // Postfix relays but files no copy: filing Sent is the client's job, and nothing was doing it.
  async append(address: string, folder: string, raw: Buffer, flags: string[]): Promise<void> {
    await this.connected(address, async (client) => {
      await client.append(folder, raw, flags);
    });
  }

  async createFolder(address: string, path: string): Promise<void> {
    await this.connected(address, async (client) => {
      await client.mailboxCreate(path);
    });
  }

  async renameFolder(address: string, path: string, target: string): Promise<void> {
    await this.connected(address, async (client) => {
      await client.mailboxRename(path, target);
    });
  }

  async deleteFolder(address: string, path: string): Promise<void> {
    await this.connected(address, async (client) => {
      await client.mailboxDelete(path);
    });
  }

  // Per operation and closed after: a pool keyed by mailbox holds a session per panel user.
  private async connected<T>(
    address: string,
    action: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow({
      host: this.config.MAIL_IMAP_HOST,
      port: this.config.MAIL_IMAP_PORT,
      secure: this.config.MAIL_IMAP_PORT === 993,
      auth: {
        // Dovecot master user: the API never holds a mailbox's own password.
        user: `${address}*${this.config.MAIL_MASTER_USER}`,
        pass: this.config.MAIL_MASTER_PASSWORD,
      },
      logger: false,
    });

    try {
      await client.connect();

      return await action(client);
    } catch (error) {
      this.logger.error(
        `IMAP failed for ${address}: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new ServiceUnavailableException('The mail server is not reachable');
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

function toParsedBody(parsed: ParsedMail): ParsedBody {
  return {
    html: typeof parsed.html === 'string' ? parsed.html : null,
    text: parsed.text ?? null,
    to: addressesOf(parsed.to),
    cc: addressesOf(parsed.cc),
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? 'attachment',
      contentType: attachment.contentType,
      size: attachment.size,
    })),
  };
}

// mailparser hands back one header or an array of them; both carry the same list underneath.
function addressesOf(field: ParsedMail['to']): string[] {
  const groups = field === undefined ? [] : Array.isArray(field) ? field : [field];

  return groups
    .flatMap((group) => group.value)
    .map((entry) => entry.address ?? '')
    .filter((entry) => entry !== '');
}
