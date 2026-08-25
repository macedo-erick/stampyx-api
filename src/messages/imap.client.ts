import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { CONFIG, type Config } from '../config';

export interface FetchedAttachment {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Buffer;
}

export interface ParsedBody {
  readonly html: string | null;
  readonly text: string | null;
  readonly attachments: readonly {
    filename: string;
    contentType: string;
    size: number;
  }[];
}

// The server decides both of these. Hard-coding a separator is how a hierarchy silently
// stops working when the namespace is configured differently.
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
  readonly date: string;
  readonly seen: boolean;
}

export interface ImapOperations {
  fetchBody(address: string, folder: string, uid: number): Promise<ParsedBody | null>;
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

      return {
        html: typeof parsed.html === 'string' ? parsed.html : null,
        text: parsed.text ?? null,
        attachments: parsed.attachments.map((attachment) => ({
          filename: attachment.filename ?? 'attachment',
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      };
    });
  }

  // The list only carries names and sizes; the bytes are read on demand, straight from the
  // message source, so nothing is copied to disk to be served.
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

  // Sent mail is appended, never delivered, so it never passes the notify pipe and cannot
  // come from the received_message projection. For that folder IMAP is the only source.
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
          date: (envelope?.date ?? new Date()).toISOString(),
          seen: message.flags?.has('\\Seen') ?? false,
        });
      }

      return rows.reverse();
    });
  }

  // Sieve runs before the message has a UID, so the notify pipe cannot report one and every
  // row arrives with imapUid null. The Message-ID is the only handle that exists at both
  // ends, so it is what finds the message again.
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

  // Postfix relays the message but never files a copy: putting it in Sent is the client's
  // job, and nothing was doing it, so a sent message existed nowhere the panel could see.
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

  // Connections are per operation and closed straight after. A pool keyed by mailbox would
  // hold an open IMAP session per panel user, which is the wrong shape for a request API.
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
