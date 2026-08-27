import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

import { AccountService } from '../accounts/account.service';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { Identity, Principal } from './principal';

// Shared with the WebSocket gateway, so a socket faces the same standing checks as a request.
@Injectable()
export class PrincipalResolver {
  constructor(
    private readonly accounts: AccountService,
    private readonly mailboxes: MailboxRepository,
  ) {}

  async resolve(identity: Identity): Promise<Principal> {
    if (identity.kind === 'keycloak') {
      const account = await this.accounts.requireActive(identity);

      return { kind: 'account', accountId: account.id, admin: identity.admin };
    }

    const standing = await this.mailboxes.findStanding(identity.mailboxId);

    if (standing?.accountId !== identity.accountId) {
      throw new UnauthorizedException('This session is no longer valid');
    }

    // The conditions v_dovecot_users applies: what the mail server refuses, the panel refuses.
    if (!standing.active) {
      throw new ForbiddenException('This mailbox is disabled');
    }

    if (!standing.domainActive || standing.domainVerifiedAt === null) {
      throw new ForbiddenException('This mailbox is on a domain that is not active');
    }

    if (standing.accountStatus !== 'active') {
      throw new ForbiddenException('The account this mailbox belongs to is not active');
    }

    return { kind: 'mailbox', accountId: standing.accountId, mailboxId: standing.id };
  }

  async mayRead(principal: Principal, mailboxId: string): Promise<boolean> {
    if (principal.kind === 'mailbox') {
      return principal.mailboxId === mailboxId;
    }

    return (await this.mailboxes.findOwned(principal.accountId, mailboxId)) !== null;
  }
}
