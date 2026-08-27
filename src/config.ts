import { z } from 'zod';

const schema = z.object({
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5435),
  POSTGRES_DB: z.string().min(1).default('stampyx'),
  POSTGRES_USER: z.string().min(1).default('stampyx'),
  POSTGRES_PASSWORD: z.string().min(1).default('stampyx'),

  HTTP_HOST: z.string().min(1).default('127.0.0.1'),
  HTTP_PORT: z.coerce.number().int().positive().default(8092),

  KEYCLOAK_ISSUER_URI: z.url().default('http://localhost:8093/auth/realms/stampyx'),
  KEYCLOAK_JWKS_URI: z.url().optional(),

  KEYCLOAK_SERVER_URL: z.url().default('http://localhost:8093/auth'),
  KEYCLOAK_REALM: z.string().min(1).default('stampyx'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('stampyx-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).default('local-dev-secret'),

  STAMPYX_PROVISIONING_SECRET: z.string().min(1).default('local-dev-secret'),

  MAIL_INTERNAL_SECRET: z.string().min(1).default('local-dev-secret'),

  MAIL_HOSTNAME: z.string().min(1).default('mail.stampyx.com'),
  MAIL_PUBLIC_IP: z.string().min(1).default('127.0.0.1'),
  DMARC_REPORT_EMAIL: z.string().min(1).default('dmarc@stampyx.com'),

  MAIL_IMAP_HOST: z.string().min(1).default('localhost'),
  MAIL_IMAP_PORT: z.coerce.number().int().positive().default(993),
  MAIL_SMTP_HOST: z.string().min(1).default('localhost'),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().default(587),
  MAIL_MASTER_USER: z.string().min(1).default('stampyx-api'),
  MAIL_MASTER_PASSWORD: z.string().min(1).default('local-dev-secret'),

  MAIL_SIEVE_DIR: z.string().min(1).default('/data/sieve'),
  MAIL_ATTACHMENTS_DIR: z.string().min(1).default('/data/attachments'),

  MAIL_MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(26_214_400),

  STAMPYX_PLATFORM_DOMAINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name !== ''),
    ),

  STAMPYX_JWT_SECRET: z.string().min(32).default('local-dev-secret-local-dev-secret'),
  STAMPYX_MAILBOX_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  STAMPYX_MAILBOX_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  STAMPYX_ADMIN_ROLE: z.string().min(1).default('stampyx-admin'),

  STAMPYX_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),

  STAMPYX_ACCOUNT_AUTO_APPROVE: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((value) => value === 'true' || value === '1'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new ConfigError(`Invalid environment configuration:\n${detail}`);
  }

  return result.data;
}

export function databaseUrl(config: Config): string {
  const { DB_HOST, DB_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = config;
  const credentials = `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}`;

  return `postgres://${credentials}@${DB_HOST}:${String(DB_PORT)}/${POSTGRES_DB}`;
}

export function jwksUri(config: Config): URL {
  if (config.KEYCLOAK_JWKS_URI !== undefined) {
    return new URL(config.KEYCLOAK_JWKS_URI);
  }

  return new URL(`${config.KEYCLOAK_ISSUER_URI}/protocol/openid-connect/certs`);
}

export const CONFIG = Symbol('STAMPYX_CONFIG');
