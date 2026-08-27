import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AccountRepository } from '../accounts/account.repository';
import { MailboxSessionRepository } from '../auth/mailbox-session.repository';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import { hashMailboxPassword } from '../mailboxes/password';
import { AdminRepository } from './admin.repository';
import type { AdminAccountResponse, AdminDomainResponse, AdminMailboxResponse } from './dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly repository: AdminRepository,
    private readonly accounts: AccountRepository,
    private readonly mailboxes: MailboxRepository,
    private readonly sessions: MailboxSessionRepository,
  ) {}

  async listAccounts(): Promise<AdminAccountResponse[]> {
    const rows = await this.repository.listAccounts();

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      domainCount: row.domainCount,
      mailboxCount: row.mailboxCount,
    }));
  }

  async listDomains(): Promise<AdminDomainResponse[]> {
    const rows = await this.repository.listDomains();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      accountId: row.accountId,
      accountEmail: row.accountEmail,
      verified: row.verifiedAt !== null,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listMailboxes(): Promise<AdminMailboxResponse[]> {
    const rows = await this.repository.listMailboxes();

    return rows.map((row) => ({
      id: row.id,
      address: `${row.localPart}@${row.domainName}`,
      accountId: row.accountId,
      accountEmail: row.accountEmail,
      domainKind: row.domainKind,
      quotaMb: row.quotaMb,
      active: row.active,
      lockedUntil: row.lockedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async setStatus(
    id: string,
    status: 'pending' | 'active' | 'suspended',
  ): Promise<AdminAccountResponse> {
    if ((await this.accounts.setStatus(id, status)) === null) {
      throw new NotFoundException('No such account');
    }

    this.logger.log({ event: 'account.status_changed', accountId: id, status });

    const found = (await this.listAccounts()).find((row) => row.id === id);

    if (found === undefined) {
      throw new NotFoundException('No such account');
    }

    return found;
  }

  async deleteAccount(actorAccountId: string, id: string): Promise<void> {
    if (actorAccountId === id) {
      throw new BadRequestException('An administrator cannot delete their own account');
    }

    if (!(await this.repository.deleteAccount(id))) {
      throw new NotFoundException('No such account');
    }

    this.logger.log({ event: 'account.deleted', accountId: id });
  }

  async resetMailboxPassword(id: string, password: string): Promise<void> {
    if ((await this.repository.findMailbox(id)) === null) {
      throw new NotFoundException('No such mailbox');
    }

    await this.mailboxes.setPasswordHash(id, await hashMailboxPassword(password));
    await this.sessions.deleteForMailbox(id);

    this.logger.log({ event: 'mailbox.password_changed', mailboxId: id });
  }

  async deleteMailbox(id: string): Promise<void> {
    if (!(await this.repository.deleteMailbox(id))) {
      throw new NotFoundException('No such mailbox');
    }

    this.logger.log({ event: 'mailbox.deleted', mailboxId: id });
  }
}
