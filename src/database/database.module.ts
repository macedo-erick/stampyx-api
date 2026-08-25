import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { CONFIG, type Config, databaseUrl } from '../config';
import { DATABASE, type DatabaseHandle, createDatabase } from './db';

const DATABASE_HANDLE = Symbol('STAMPYX_DATABASE_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [CONFIG],
      useFactory: (config: Config): DatabaseHandle => createDatabase(databaseUrl(config)),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_HANDLE],
      useFactory: (handle: DatabaseHandle) => handle.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
