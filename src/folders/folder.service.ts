import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { ImapFolder } from '../messages/imap.client';
import { ImapClient } from '../messages/imap.client';
import type { CreateFolderRequest, FolderResponse } from './dto';
import { FolderRepository } from './folder.repository';

// Fallback only: every real listing carries the server's own delimiter.
const DEFAULT_DELIMITER = '/';

@Injectable()
export class FolderService {
  private readonly logger = new Logger(FolderService.name);

  constructor(
    private readonly repository: FolderRepository,
    private readonly mailboxes: MailboxRepository,
    private readonly imap: ImapClient,
  ) {}

  async list(accountId: string, mailboxId: string): Promise<FolderResponse[]> {
    const address = await this.address(accountId, mailboxId);

    // From IMAP, not from the message rows: a folder with nothing in it is still a folder,
    // and an empty one used to be invisible to the panel.
    const folders = await this.imap.listFolders(address);
    const counts = new Map(
      (await this.repository.counts(mailboxId)).map((row) => [row.folder, row] as const),
    );
    const rules = new Map(
      (await this.repository.ruleTargets(mailboxId)).map((row) => [row.folder, row.total] as const),
    );

    return folders
      .map((folder) => {
        const seen = counts.get(folder.path);
        const cut = folder.path.lastIndexOf(folder.delimiter);

        return {
          path: folder.path,
          name: cut === -1 ? folder.path : folder.path.slice(cut + 1),
          parent: cut === -1 ? null : folder.path.slice(0, cut),
          total: seen?.total ?? 0,
          unread: seen?.unread ?? 0,
          system: isSystem(folder),
          specialUse: folder.specialUse,
          ruleCount: rules.get(folder.path) ?? 0,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async create(
    accountId: string,
    mailboxId: string,
    input: CreateFolderRequest,
  ): Promise<FolderResponse> {
    const address = await this.address(accountId, mailboxId);
    const existing = await this.imap.listFolders(address);
    const delimiter = delimiterOf(existing);

    if (input.parent !== undefined && !existing.some((row) => row.path === input.parent)) {
      throw new NotFoundException('No such parent folder');
    }

    // Built with the separator the server reported, not an assumed one: get this wrong and
    // the folder is created with a literal slash in its name instead of nested.
    const path =
      input.parent === undefined ? input.name : `${input.parent}${delimiter}${input.name}`;

    if (existing.some((row) => row.path.toLowerCase() === path.toLowerCase())) {
      throw new ConflictException('That folder already exists');
    }

    await this.imap.createFolder(address, path);
    this.logger.log({ event: 'folder.created', mailboxId, path });

    return this.requireOne(accountId, mailboxId, path);
  }

  async rename(
    accountId: string,
    mailboxId: string,
    path: string,
    name: string,
  ): Promise<FolderResponse> {
    const address = await this.address(accountId, mailboxId);
    const found = await this.require(address, path);
    const delimiter = found.delimiter;

    this.requireNotSystem(found);

    const cut = path.lastIndexOf(delimiter);
    const target = cut === -1 ? name : `${path.slice(0, cut)}${delimiter}${name}`;

    if (target === path) {
      return this.requireOne(accountId, mailboxId, path);
    }

    await this.imap.renameFolder(address, path, target);
    await this.repository.renameSubtree(mailboxId, path, target, delimiter);
    this.logger.log({ event: 'folder.renamed', mailboxId, path, target });

    return this.requireOne(accountId, mailboxId, target);
  }

  async delete(accountId: string, mailboxId: string, path: string): Promise<void> {
    const address = await this.address(accountId, mailboxId);
    const found = await this.require(address, path);

    this.requireNotSystem(found);

    // Deleting it out from under a rule would leave a Sieve script filing into a folder
    // that no longer exists, and the message would land back in INBOX with no explanation.
    const used = (await this.repository.ruleTargets(mailboxId)).find((row) => row.folder === path);

    if (used !== undefined) {
      throw new ConflictException(
        `${String(used.total)} rule(s) move messages into this folder. Point them elsewhere first.`,
      );
    }

    await this.imap.deleteFolder(address, path);
    await this.repository.deleteSubtree(mailboxId, path, found.delimiter);
    this.logger.log({ event: 'folder.deleted', mailboxId, path });
  }

  private requireNotSystem(folder: ImapFolder): void {
    if (isSystem(folder)) {
      throw new ForbiddenException('That folder belongs to the mail server');
    }
  }

  private async require(address: string, path: string): Promise<ImapFolder> {
    const found = (await this.imap.listFolders(address)).find((row) => row.path === path);

    if (found === undefined) {
      throw new NotFoundException('No such folder');
    }

    return found;
  }

  private async requireOne(
    accountId: string,
    mailboxId: string,
    path: string,
  ): Promise<FolderResponse> {
    const found = (await this.list(accountId, mailboxId)).find((row) => row.path === path);

    if (found === undefined) {
      throw new NotFoundException('No such folder');
    }

    return found;
  }

  private async address(accountId: string, mailboxId: string): Promise<string> {
    const owned = await this.mailboxes.findOwned(accountId, mailboxId);

    if (owned === null) {
      throw new NotFoundException('No such mailbox');
    }

    return `${owned.localPart}@${owned.domainName}`;
  }
}

// A folder the server flagged with SPECIAL-USE, plus INBOX itself. Matching on the name
// instead would call a user's own folder named "Archive" a system one.
function isSystem(folder: ImapFolder): boolean {
  return folder.path.toUpperCase() === 'INBOX' || folder.specialUse !== null;
}

function delimiterOf(folders: readonly ImapFolder[]): string {
  return folders[0]?.delimiter ?? DEFAULT_DELIMITER;
}
