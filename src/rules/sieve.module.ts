import { Module } from '@nestjs/common';

import { SieveWriter } from './sieve.writer';

// Its own module because two things need it and neither may depend on the other: rules
// regenerate the script, and mailbox creation lays down the first one.
@Module({
  providers: [SieveWriter],
  exports: [SieveWriter],
})
export class SieveModule {}
