import { Module } from '@nestjs/common';

import { SieveWriter } from './sieve.writer';

@Module({
  providers: [SieveWriter],
  exports: [SieveWriter],
})
export class SieveModule {}
