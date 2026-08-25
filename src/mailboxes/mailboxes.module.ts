import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { DomainsModule } from '../domains/domains.module';
import { SieveModule } from '../rules/sieve.module';
import { DomainMailboxController, MailboxController } from './mailbox.controller';
import { MailboxRepository } from './mailbox.repository';
import { MailboxService } from './mailbox.service';

@Module({
  imports: [AccountsModule, DomainsModule, SieveModule],
  controllers: [DomainMailboxController, MailboxController],
  providers: [MailboxRepository, MailboxService],
  exports: [MailboxRepository, MailboxService],
})
export class MailboxesModule {}
