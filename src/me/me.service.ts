import { Injectable, NotFoundException } from '@nestjs/common';

import { AccountRepository } from '../accounts/account.repository';
import type { Principal } from '../auth/principal';
import { PlatformDomainService } from '../domains/platform.service';
import type { MailboxResponse } from '../mailboxes/dto';
import { MailboxService } from '../mailboxes/mailbox.service';
import type { MeResponse } from './dto';
import { suggestAddress } from './suggest';

@Injectable()
export class MeService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly mailboxes: MailboxService,
    private readonly platform: PlatformDomainService,
  ) {}

  private async autoClaim(
    accountId: string,
    email: string,
    offered: readonly { id: string; name: string }[],
  ): Promise<MailboxResponse | null> {
    const suggestion = suggestAddress(email, offered);

    if (suggestion === null) {
      return null;
    }

    try {
      return await this.mailboxes.createOnPlatform(
        accountId,
        suggestion.domainId,
        suggestion.localPart,
      );
    } catch {
      return null;
    }
  }

  async describe(principal: Principal): Promise<MeResponse> {
    if (principal.kind === 'mailbox') {
      const mailbox = await this.mailboxes.get(principal.accountId, principal.mailboxId);

      return {
        kind: 'mailbox',
        admin: false,
        displayName: mailbox.address,
        loginEmail: mailbox.address,
        mailboxes: [mailbox],
        platformAddress: mailbox.platform ? mailbox.address : null,
        needsAddress: false,
        suggestedLocalPart: null,
        suggestedDomainId: null,
      };
    }

    const account = await this.accounts.findById(principal.accountId);

    if (account === null) {
      throw new NotFoundException('No such account');
    }

    const offered = await this.platform.listActive();
    let mailboxes = await this.mailboxes.listForAccount(principal.accountId);
    let platformAddress = mailboxes.find((row) => row.platform) ?? null;

    if (platformAddress === null && offered.length > 0) {
      const claimed = await this.autoClaim(principal.accountId, account.email, offered);

      if (claimed !== null) {
        mailboxes = await this.mailboxes.listForAccount(principal.accountId);
        platformAddress = claimed;
      }
    }

    const suggestion = suggestAddress(account.email, offered);

    return {
      kind: 'account',
      admin: principal.admin,
      displayName: account.name,
      loginEmail: account.email,
      mailboxes,
      platformAddress: platformAddress?.address ?? null,
      needsAddress: platformAddress === null && offered.length > 0,
      suggestedLocalPart: suggestion?.localPart ?? null,
      suggestedDomainId: suggestion?.domainId ?? null,
    };
  }
}
