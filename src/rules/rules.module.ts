import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { RuleController } from './rule.controller';
import { RuleRepository } from './rule.repository';
import { RuleService } from './rule.service';
import { SieveModule } from './sieve.module';
import { SieveReconciler } from './sieve.reconciler';

@Module({
  imports: [AccountsModule, MailboxesModule, SieveModule],
  controllers: [RuleController],
  providers: [RuleRepository, RuleService, SieveReconciler],
  exports: [RuleRepository, SieveModule],
})
export class RulesModule {}
