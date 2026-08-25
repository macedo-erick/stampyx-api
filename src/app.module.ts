import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AccountsModule } from './accounts/accounts.module';
import { AdminModule } from './admin/admin.module';
import { AliasesModule } from './aliases/aliases.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { CONFIG, type Config } from './config';
import { ConfigModule } from './config.module';
import { DatabaseModule } from './database/database.module';
import { DomainsModule } from './domains/domains.module';
import { FoldersModule } from './folders/folders.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { MeModule } from './me/me.module';
import { MessagesModule } from './messages/messages.module';
import { RulesModule } from './rules/rules.module';
import { WarmupModule } from './warmup/warmup.module';
import { loggerOptions } from './logging';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [CONFIG],
      useFactory: (config: Config) => loggerOptions(config),
    }),
    DatabaseModule,
    MetricsModule,
    HealthModule,
    AccountsModule,
    AuthModule,
    AliasesModule,
    AttachmentsModule,
    AdminModule,
    DomainsModule,
    FoldersModule,
    MailboxesModule,
    MeModule,
    RulesModule,
    WarmupModule,
    InternalModule,
    MessagesModule,
  ],
  providers: [HttpMetricsMiddleware, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
