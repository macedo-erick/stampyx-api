import { Module } from '@nestjs/common';

import { DomainsModule } from '../domains/domains.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [DomainsModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
