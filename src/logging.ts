import type { Params } from 'nestjs-pino';

import type { Config } from './config';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-planelyx-signature"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'dkimPrivateKey',
  '*.dkimPrivateKey',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
];

export type WriteEvent =
  | 'account.provisioned'
  | 'account.approved'
  | 'account.suspended'
  | 'domain.created'
  | 'domain.verified'
  | 'domain.deleted'
  | 'mailbox.created'
  | 'mailbox.password_changed'
  | 'mailbox.deleted'
  | 'message.sent'
  | 'message.received'
  | 'message.moved'
  | 'message.deleted'
  | 'message.marked_spam'
  | 'message.marked_not_spam'
  | 'rule.created'
  | 'rule.updated'
  | 'rule.reordered'
  | 'rule.deleted'
  | 'sieve.regenerated'
  | 'warmup.started'
  | 'warmup.cap_exceeded';

export function loggerOptions(config: Config): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      autoLogging: {
        ignore: (request) => request.url === '/health' || request.url === '/metrics',
      },
      ...(config.LOG_PRETTY
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  };
}
