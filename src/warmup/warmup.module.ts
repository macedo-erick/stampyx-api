import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { MetricsModule } from '../metrics/metrics.module';
import { WarmupController } from './warmup.controller';
import { WarmupService } from './warmup.service';

@Module({
  imports: [AccountsModule, MetricsModule],
  controllers: [WarmupController],
  providers: [WarmupService],
  exports: [WarmupService],
})
export class WarmupModule {}
