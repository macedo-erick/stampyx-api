import { Global, Module } from '@nestjs/common';

import { CONFIG, type Config, loadConfig } from './config';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): Config => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
