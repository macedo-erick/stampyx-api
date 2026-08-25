import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DomainRepository } from '../domains/domain.repository';
import { SieveWriter } from '../rules/sieve.writer';
import type { CreateMailboxRequest, MailboxResponse } from './dto';
import type { OwnedMailbox } from './mailbox.repository';
import { MailboxRepository } from './mailbox.repository';
import { hashMailboxPassword, unusableMailboxPassword } from './password';
import { isReservedLocalPart } from './reserved-local-parts';

@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);

  constructor(
    private readonly repository: MailboxRepository,
    private readonly domains: DomainRepository,
    private readonly sieve: SieveWriter,
  ) {}

  async listForDomain(accountId: string, domainId: string): Promise<MailboxResponse[]> {
    // Explicit, so an unknown domain is 404 rather than an empty list that reads as
    // "no mailboxes here".
    if ((await this.domains.findOwned(accountId, domainId)) === null) {
      throw new NotFoundException('No such domain');
    }

    const rows = await this.repository.listForDomain(accountId, domainId);

    return rows.map((row) => toResponse(row));
  }

  async get(accountId: string, id: string): Promise<MailboxResponse> {
    return toResponse(await this.requireOwned(accountId, id));
  }

  async create(
    accountId: string,
    domainId: string,
    input: CreateMailboxRequest,
  ): Promise<MailboxResponse> {
    const owned = await this.domains.findOwned(accountId, domainId);

    if (owned === null) {
      throw new NotFoundException('No such domain');
    }

    if (await this.repository.existsAt(domainId, input.localPart)) {
      throw new ConflictException('That mailbox already exists on this domain');
    }

    const created = await this.repository.insert({
      id: randomUUID(),
      domainId,
      accountId,
      localPart: input.localPart,
      passwordHash: await hashMailboxPassword(input.password),
      quotaMb: input.quotaMb,
    });

    // The Sieve script is what installs the notify pipe, and the pipe is the only thing
    // that records an incoming message. Until now it was written only when a rule changed,
    // so a mailbox that never had a rule never reported a single delivery.
    await this.installSieve(owned.name, input.localPart);

    this.logger.log({ event: 'mailbox.created', mailboxId: created.id, accountId });

    return toResponse({
      ...created,
      domainName: owned.name,
      domainKind: owned.kind,
      domainVerifiedAt: owned.verifiedAt,
    });
  }

  async listForAccount(accountId: string): Promise<MailboxResponse[]> {
    const rows = await this.repository.listForAccount(accountId);

    return rows.map((row) => toResponse(row));
  }

  async platformAddressFor(accountId: string): Promise<MailboxResponse | null> {
    const rows = await this.repository.listForAccount(accountId);
    const platform = rows.find((row) => row.domainKind === 'platform');

    return platform === undefined ? null : toResponse(platform);
  }

  async isAvailable(domainId: string, localPart: string): Promise<boolean> {
    if (isReservedLocalPart(localPart)) {
      return false;
    }

    return !(await this.repository.existsAt(domainId, localPart));
  }

  // The consumer path. The domain belongs to nobody, so ownership cannot be checked against
  // it - the new mailbox carries the account itself.
  async createOnPlatform(
    accountId: string,
    domainId: string,
    localPart: string,
  ): Promise<MailboxResponse> {
    const platform = await this.domains.findPlatform(domainId);

    if (platform?.active !== true) {
      throw new NotFoundException('No such platform domain');
    }

    const existing = await this.platformAddressFor(accountId);

    if (existing !== null) {
      if (existing.domainId === domainId && existing.localPart === localPart) {
        return existing;
      }

      throw new ConflictException('This account already has a stampyx address');
    }

    if (isReservedLocalPart(localPart)) {
      throw new ConflictException('That address is reserved');
    }

    if (await this.repository.existsAt(domainId, localPart)) {
      throw new ConflictException('That address is already taken');
    }

    const created = await this.repository.insert({
      id: randomUUID(),
      domainId,
      accountId,
      // No mail password yet: the panel signs in through Keycloak, and IMAP stays shut until
      // the owner sets one for an external client.
      passwordHash: await unusableMailboxPassword(),
      localPart,
    });

    await this.installSieve(platform.name, localPart);

    this.logger.log({ event: 'mailbox.created', mailboxId: created.id, accountId });

    return toResponse({
      ...created,
      domainName: platform.name,
      domainKind: platform.kind,
      domainVerifiedAt: platform.verifiedAt,
    });
  }

  async setPassword(accountId: string, id: string, password: string): Promise<void> {
    const owned = await this.requireOwned(accountId, id);

    await this.repository.setPasswordHash(owned.id, await hashMailboxPassword(password));

    this.logger.log({ event: 'mailbox.password_changed', mailboxId: id, accountId });
  }

  async delete(accountId: string, id: string): Promise<void> {
    const owned = await this.requireOwned(accountId, id);

    await this.repository.delete(owned.id);

    this.logger.log({ event: 'mailbox.deleted', mailboxId: id, accountId });
  }

  // Empty rule set: the generated script still carries the notify pipe, which is the point.
  private async installSieve(domainName: string, localPart: string): Promise<void> {
    try {
      await this.sieve.write({ domainName, localPart }, []);
    } catch (error) {
      // A mailbox that exists without a script still receives mail; it just will not report
      // deliveries until the next rule change rewrites it.
      this.logger.warn({
        event: 'mailbox.sieve_failed',
        localPart,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requireOwned(accountId: string, id: string): Promise<OwnedMailbox> {
    const row = await this.repository.findOwned(accountId, id);

    if (row === null) {
      throw new NotFoundException('No such mailbox');
    }

    return row;
  }
}

function toResponse(row: OwnedMailbox): MailboxResponse {
  return {
    id: row.id,
    domainId: row.domainId,
    address: `${row.localPart}@${row.domainName}`,
    localPart: row.localPart,
    quotaMb: row.quotaMb,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    platform: row.domainKind === 'platform',
    deliverable: row.active && row.domainVerifiedAt !== null,
  };
}
