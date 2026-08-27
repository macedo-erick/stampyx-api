import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { CONFIG, type Config } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get<Config>(CONFIG);

  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api', { exclude: ['health', 'metrics', 'internal/(.*)'] });

  app.enableCors({
    origin: config.STAMPYX_CORS_ORIGINS,
    credentials: false,
  });

  app.enableShutdownHooks();

  await app.listen(config.HTTP_PORT, config.HTTP_HOST);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
