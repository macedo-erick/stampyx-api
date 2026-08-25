import { Module } from '@nestjs/common';

import { MetricsModule } from '../metrics/metrics.module';
import { InternalSecretGuard } from './internal-secret.guard';
import { MailController } from './mail.controller';
import { MailGateway } from './mail.gateway';

@Module({
  imports: [MetricsModule],
  controllers: [MailController],
  providers: [InternalSecretGuard, MailGateway],
  exports: [MailGateway],
})
export class InternalModule {}
