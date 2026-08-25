Expert TypeScript, NestJS and PostgreSQL. Strictly typed, minimal ceremony.

**Comments** — Write almost none. No JSDoc blocks. Do not restate what the code says. A short `//` only where a decision would otherwise be re-litigated. Reasoning belongs in the README or the commit message.

**TypeScript** — Strict; prefer inference. Never `any` — use `unknown` and narrow. The `no-unsafe-*` rules are errors on purpose. `interface` for object shapes.

**Style** — `yarn lint` and `yarn format:check` before committing. Blank line before `return`, and around `if`/`else`.

**Architecture** — One module per feature (`accounts/`, `admin/`, `aliases/`, `auth/`, `domains/`, `mailboxes/`, `me/`, `messages/`, `rules/`, `warmup/`, `internal/`) with its controller, service, repository and `dto.ts`. Cross-module reuse goes through an exported provider. Controllers route and validate. Services hold rules. Repositories hold SQL. Symbols as injection tokens for anything that is not a class.

**Ownership** — `accountId` is a parameter on every service and repository method, never ambient request state. Filter by owner in SQL, not after fetching. Someone else's row answers 404, not 403. `PrincipalGuard` resolves the token once; controllers take `@CurrentAccount()`.

A mailbox hangs off `mailbox.account_id`, not off its domain's owner: a mailbox on a platform domain belongs to someone who does not own that domain. Two kinds of principal reach a controller and both carry an `accountId`, so account-scoped SQL is unchanged. A mailbox principal resolves to the account that owns its domain, which means account scoping alone would hand it every sibling mailbox — `MailboxScopeGuard` adds the second narrowing, and any route holding a `:mailboxId` needs it. Name that parameter `mailboxId`, never `id`, or the guard silently does nothing.

`admin/` is the one module that queries without an `accountId`, because listing every tenant is its purpose. Nothing outside it may. It exposes no way to read anyone's mail: the master IMAP user would make that trivial, which is exactly why there is no endpoint for it.

**Schema** — The app never touches DDL. `drizzle-kit generate` writes SQL, it is reviewed as its own diff, and `yarn db:migrate` applies it before the app starts. Rename the generated file descriptively and update its `tag` in `drizzle/meta/_journal.json`. The three Postfix/Dovecot views are hand-written at the end of the migration; drizzle-kit does not emit views.

**Mail plane** — Postfix and Dovecot read `v_postfix_domains`, `v_dovecot_users` and `v_postfix_senders` directly. Never widen those views without working out what it lets an unverified or suspended account do. They reach the account through `mailbox.account_id`; `v_postfix_domains` needs a `LEFT JOIN` because a platform domain has no owner. A platform domain is seeded verified and its DNS is published by us, so it never carries a challenge TXT.

**Sieve** — Every user value is escaped before it reaches the script. The order is fixed: spam, then user rules, then the notify pipe. Regenerate the whole script; never patch it.

**Logging** — Structured JSON via `nestjs-pino`. No `console.log`. One event per write, from the `WriteEvent` union in `logging.ts`.

**Testing** — Integration tests over real HTTP against a real PostgreSQL container. Only token verification, DNS, IMAP and the Sieve writer are faked. Test names are sentences describing behaviour.
