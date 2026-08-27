import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { Config } from './config';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-planelyx-signature"]',
  'req.headers["x-stampyx-internal"]',
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

const KEPT_HEADERS = ['content-type', 'content-length', 'user-agent'];

// A Nest HttpException also carries `response` and `options`, which only repeat the message
// and status that are already fields of their own here.
const KEPT_ERROR_FIELDS = ['code', 'errno', 'syscall', 'path', 'status'];

export type WriteEvent =
  | 'account.deleted'
  | 'account.provisioned'
  | 'account.status_changed'
  | 'attachment.deleted'
  | 'attachment.uploaded'
  | 'domain.created'
  | 'domain.deleted'
  | 'domain.verified'
  | 'folder.created'
  | 'folder.deleted'
  | 'folder.renamed'
  | 'folder.status_unavailable'
  | 'mailbox.created'
  | 'mailbox.deleted'
  | 'mailbox.login_failed'
  | 'mailbox.password_changed'
  | 'mailbox.session_opened'
  | 'mailbox.sieve_failed'
  | 'message.deleted'
  | 'message.draft_discard_failed'
  | 'message.draft_saved'
  | 'message.moved'
  | 'message.received'
  | 'message.sent'
  | 'message.sent_copy_failed'
  | 'message.sync_deduped'
  | 'message.sync_skipped'
  | 'message.thread_body_skipped'
  | 'message.transport_unreachable'
  | 'message.trashed'
  | 'platform_domain.seeded'
  | 'rule.created'
  | 'rule.deleted'
  | 'rule.reordered'
  | 'rule.updated'
  | 'sieve.reconcile_failed'
  | 'sieve.reconciled'
  | 'sieve.regenerated'
  | 'socket.join_refused'
  | 'warmup.cap_exceeded';

function headersOf(headers: IncomingMessage['headers']): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const name of KEPT_HEADERS) {
    const value = headers[name];

    if (typeof value === 'string') {
      kept[name] = value;
    }
  }

  return kept;
}

interface FailedResponse extends ServerResponse {
  failureReason?: string;
}

// pino-http already logs one line per request, and without a cause it invents a contentless
// "failed with status code 500" carrying its own stack. res.err is the hook it reads first.
export function recordFailure(
  response: ServerResponse,
  status: number,
  exception: unknown,
  reason: string,
): void {
  const carrier = response as FailedResponse;

  if (status >= 500) {
    response.err = exception instanceof Error ? exception : new Error(String(exception));

    return;
  }

  carrier.failureReason = reason;
}

// pino-http wraps a custom `err` serializer around the standard one, so what arrives here is
// pino's already-flattened error shape -- `type`, not an Error with a `name`.
interface SerializedError {
  readonly type?: string;
  readonly message?: string;
  readonly stack?: string;
}

function errorOf(error: SerializedError): Record<string, unknown> {
  const carried: Record<string, unknown> = {
    type: error.type,
    message: error.message,
    stack: error.stack,
  };

  for (const field of KEPT_ERROR_FIELDS) {
    const value = (error as unknown as Record<string, unknown>)[field];

    if (value !== undefined) {
      carried[field] = value;
    }
  }

  return carried;
}

export function loggerOptions(config: Config): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },

      // Otherwise every line logged during a request carries a full copy of that request;
      // the id joins them back onto the one completion line that has the rest.
      quietReqLogger: true,

      genReqId: (request: IncomingMessage, response: ServerResponse): string => {
        const carried = request.headers['x-request-id'];
        const id = typeof carried === 'string' && carried !== '' ? carried : randomUUID();

        response.setHeader('x-request-id', id);

        return id;
      },

      customLogLevel: (_request, response, error) => {
        if (error !== undefined || response.statusCode >= 500) {
          return 'error';
        }

        return response.statusCode >= 400 ? 'warn' : 'info';
      },

      customProps: (_request, response) => {
        const reason = (response as FailedResponse).failureReason;

        return reason === undefined ? {} : { reason };
      },

      customSuccessMessage: (request, response) =>
        `${request.method ?? 'GET'} ${request.url ?? '/'} ${String(response.statusCode)}`,

      customErrorMessage: (request, response) =>
        `${request.method ?? 'GET'} ${request.url ?? '/'} ${String(response.statusCode)}`,

      serializers: {
        req: (request: IncomingMessage & { id?: string; url?: string; method?: string }) => ({
          id: request.id,
          method: request.method,
          url: request.url,
          headers: headersOf(request.headers),
        }),
        res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
        err: errorOf,
      },

      autoLogging: {
        ignore: (request) => request.url === '/health' || request.url === '/metrics',
      },

      ...(config.LOG_PRETTY
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss.l',
                singleLine: true,
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
  };
}
