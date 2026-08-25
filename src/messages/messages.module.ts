import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MetricsModule } from '../metrics/metrics.module';
import { WarmupModule } from '../warmup/warmup.module';
import { ImapClient } from './imap.client';
import { MessageController } from './message.controller';
import { MessageRepository } from './message.repository';
import { MessageService } from './message.service';

@Module({
  imports: [AccountsModule, AttachmentsModule, MailboxesModule, MetricsModule, WarmupModule],
  controllers: [MessageController],
  providers: [MessageRepository, MessageService, ImapClient],
  exports: [MessageRepository, ImapClient],
})
export class MessagesModule {}
