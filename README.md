# stampyx-api

REST API for Stampyx: self-hosted, multi-tenant email infrastructure. It owns the domains,
mailboxes, aliases and delivery rules that Postfix and Dovecot read straight out of Postgres.

## Stack

NestJS 11 on Node 24, Drizzle over `postgres-js`, `jose` for token verification, zod for
config and request validation, `nestjs-pino` for logs, `prom-client` for metrics, Vitest with
Testcontainers for tests. Yarn 4 via Corepack.

## Getting started

```bash
corepack enable
yarn install
docker compose up -d
```

That brings up the whole stack, mail plane included, and needs no `.env`. For the API alone,
against nothing but a database: `docker compose up -d postgres keycloak`, `yarn db:migrate:dev`,
`yarn dev`.

The API listens on `127.0.0.1:8092`. Keycloak is on `8093`, Postgres on `5435` — chosen so
nothing collides with planelyx (`5433`, `8081`–`8085`) or listryx (`5434`, `8086`–`8089`) on
the shared VPS.

## The mail plane, locally

Sending is not stubbed out in development: `postfix`, `dovecot` and `rspamd` run alongside the
API, built from `stampyx-infra/mail/docker` and reading the very same configuration files that
are deployed to production, mounted from `stampyx-infra/mail/`. The API reaches them at
`postfix:587` and `dovecot:143`, exactly as it does in production.

Two things differ from the VPS, and only two:

- The TLS certificate is self-signed instead of Let's Encrypt. A one-shot `mail-certs` service
  writes it to the same path the production compose bind-mounts, and the API trusts it through
  `NODE_EXTRA_CA_CERTS` — without which every send fails certificate verification rather than
  TLS.
- Nothing relays to the internet. Mail addressed to a local virtual domain is delivered for
  real; mail to anywhere else is accepted and then sits in the Postfix queue.

`STAMPYX_PLATFORM_DOMAINS` defaults to `stampyx.com` here. It has to be set to something:
sending refuses an unverified domain, and a platform domain is the only one seeded verified.

Ports on the host, for pointing a real mail client at the stack: submission `1587`, SMTPS
`1465`, SMTP `2525`, IMAP `1143`, IMAPS `1993`.

```bash
docker compose logs -f postfix dovecot        # the whole delivery path
docker compose exec dovecot doveadm auth test -x service=smtp 'you@yours.com*stampyx-api' local-dev-secret
```

Recreating `dovecot` gives it a new address, and the Postfix processes that are already
running hold the old one; `docker compose restart postfix` after any `dovecot` recreate.

## Authentication

Two credentials exist per person, because mail protocols cannot do OIDC.

The **panel** authenticates against the shared Keycloak (`stampyx` realm). `JwtGuard` verifies
the bearer token against the issuer's JWKS and nothing else — there is no user table, and
`account.keycloak_sub` is the only link. `ActiveAccountGuard` then resolves that subject to an
account and refuses one that is `pending` or `suspended` with a 403.

**Mailboxes** authenticate against `mailbox.password_hash`, an Argon2id digest written in
Dovecot's `{ARGON2ID}$argon2id$…` form and read by Dovecot and Postfix SASL through
`v_dovecot_users`. The API itself never holds a mailbox password: it opens IMAP as
`user*master` using the Dovecot master user.

Accounts are created by the shared Keycloak SPI, which POSTs a signed body to
`/internal/keycloak/user-registered`. That endpoint verifies an HMAC over the raw bytes,
rejects anything outside a five-minute window, and is idempotent — the SPI is at-least-once
and retries three times.

## The data model

`account` owns `domain`, which owns `mailbox`, which owns messages and rules. Three views —
`v_postfix_domains`, `v_dovecot_users`, `v_postfix_senders` — are the entire surface the mail
servers see, so suspending an account cuts off mail flow and login in one write.

All three are gated on `domain.verified_at`. That is deliberate: authenticating is what lets a
client reach submission, so leaving an unverified domain in `v_dovecot_users` would let a
fresh signup send before proving it controls the domain. `v_postfix_senders` backs
`smtpd_sender_login_maps` — without it, authenticating would let one tenant send as another
tenant's verified domain, DKIM-signed by this server.

## Warmup and the send cap

`GET /api/warmup` reports the day, the cap and today's usage. The cap follows the documented
curve (20/50/100/200/400 per day by week, then unlimited) counted from the account's first
domain verification.

Unlike the design doc, the cap is **enforced**, not advisory — open signup makes an advisory
limit worthless. It is consumed in a single conditional upsert against `send_counter`, so
concurrent sends cannot both pass a check-then-increment, and a refused attempt does not
inflate the counter.

## Migrations

The app never issues DDL. `yarn db:generate` writes SQL into `drizzle/`, the file is renamed
descriptively and its `tag` updated in `drizzle/meta/_journal.json`, and the SQL is reviewed
as its own diff. Locally a one-shot `migrate` service runs before the API; in production the
deploy workflow runs `node dist/database/migrate.js` before `up -d` and aborts on failure.

## Scripts

| script | does |
|---|---|
| `yarn dev` | watch mode |
| `yarn build` / `yarn start` | compile to `dist`, run it |
| `yarn typecheck` | `tsc --noEmit` |
| `yarn lint` / `yarn format:check` | ESLint (zero warnings) / Prettier |
| `yarn test` | Vitest against a real Postgres container |
| `yarn db:generate` | write a migration from `schema.ts` |
| `yarn db:migrate` / `:dev` | apply migrations |

## Testing

Integration tests run the real `AppModule` over real HTTP against a real PostgreSQL container.
Only four things are faked: token verification (`FakeAuthGuard` reads `x-test-owner`), DNS,
IMAP, and the Sieve writer. Everything else — the guards, the SQL, the cap, the signature
verification — is exercised for real.

## Docker

Three targets: `build`, `dev`, `prod`. The prod image runs as a non-root user, carries the
migration SQL, and installs `dovecot-pigeonhole-plugin` for the `sievec` the rules module
shells out to.
