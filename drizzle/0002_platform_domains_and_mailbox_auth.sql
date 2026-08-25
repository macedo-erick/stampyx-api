CREATE TABLE "mailbox_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "domain" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "kind" varchar(16) DEFAULT 'custom' NOT NULL;--> statement-breakpoint
-- Added nullable, backfilled, then tightened: drizzle-kit emits a bare NOT NULL here, which
-- cannot work on a table that already has rows.
ALTER TABLE "mailbox" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
UPDATE "mailbox" m SET "account_id" = d."account_id" FROM "domain" d WHERE d."id" = m."domain_id";--> statement-breakpoint
ALTER TABLE "mailbox" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox_session" ADD CONSTRAINT "mailbox_session_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mailbox_session_token" ON "mailbox_session" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "idx_mailbox_session_mailbox" ON "mailbox_session" USING btree ("mailbox_id");--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mailbox_account_id" ON "mailbox" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_kind_check" CHECK ("domain"."kind" IN ('platform', 'custom'));--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_account_check" CHECK ("domain"."kind" = 'platform' OR "domain"."account_id" IS NOT NULL);--> statement-breakpoint
-- The three views again, hand-written as in 0000. REPLACE rather than DROP/CREATE so Postfix
-- and Dovecot never see a moment without them.
--
-- A platform domain has no owning account, so the account gate moves off the domain and onto
-- the mailbox's own account_id. Suspending an account still cuts mail and login in one write.
CREATE OR REPLACE VIEW "v_postfix_domains" AS
	SELECT d."name"
	FROM "domain" d
	LEFT JOIN "account" a ON a."id" = d."account_id"
	WHERE d."active"
	  AND d."verified_at" IS NOT NULL
	  AND (d."kind" = 'platform' OR (a."id" IS NOT NULL AND a."status" = 'active'));--> statement-breakpoint
CREATE OR REPLACE VIEW "v_dovecot_users" AS
	SELECT m."local_part" || '@' || d."name" AS "email",
	       m."password_hash",
	       m."quota_mb"
	FROM "mailbox" m
	JOIN "domain"  d ON d."id" = m."domain_id"
	JOIN "account" a ON a."id" = m."account_id"
	WHERE m."active"
	  AND d."active"
	  AND d."verified_at" IS NOT NULL
	  AND a."status" = 'active';--> statement-breakpoint
CREATE OR REPLACE VIEW "v_postfix_senders" AS
	SELECT m."local_part" || '@' || d."name" AS "email",
	       m."local_part" || '@' || d."name" AS "owner"
	FROM "mailbox" m
	JOIN "domain"  d ON d."id" = m."domain_id"
	JOIN "account" a ON a."id" = m."account_id"
	WHERE m."active"
	  AND d."active"
	  AND d."verified_at" IS NOT NULL
	  AND a."status" = 'active';
