import { Module } from '@nestjs/common';

import { AliasController } from './alias.controller';
import { AliasRepository } from './alias.repository';
import { AliasService } from './alias.service';

// MailboxService arrives through the global AuthModule.
@Module({
  controllers: [AliasController],
  providers: [AliasRepository, AliasService],
  exports: [AliasRepository],
})
export class AliasesModule {}
