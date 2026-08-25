CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"keycloak_sub" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(255),
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_status_check" CHECK ("account"."status" IN ('pending', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "alias" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"source" varchar(320) NOT NULL,
	"destination" varchar(320) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sent_message_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(253) NOT NULL,
	"dkim_selector" varchar(63) DEFAULT 'stampyx' NOT NULL,
	"dkim_private_key" text NOT NULL,
	"verification_token" varchar(128) NOT NULL,
	"verified_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"condition_field" varchar(16) NOT NULL,
	"condition_operator" varchar(16) NOT NULL,
	"condition_value" varchar(500) NOT NULL,
	"action" varchar(16) NOT NULL,
	"target_folder" varchar(255),
	CONSTRAINT "folder_rule_condition_field_check" CHECK ("folder_rule"."condition_field" IN ('sender', 'subject', 'recipient')),
	CONSTRAINT "folder_rule_condition_operator_check" CHECK ("folder_rule"."condition_operator" IN ('contains', 'equals', 'starts_with', 'ends_with')),
	CONSTRAINT "folder_rule_action_check" CHECK ("folder_rule"."action" IN ('move_to', 'mark_read', 'forward', 'discard')),
	CONSTRAINT "folder_rule_target_folder_check" CHECK ("folder_rule"."action" <> 'move_to' OR "folder_rule"."target_folder" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"local_part" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"quota_mb" integer DEFAULT 1024 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"date" date NOT NULL,
	"reputation" varchar(32),
	"spam_rate" integer,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_feedback_provider_check" CHECK ("provider_feedback"."provider" IN ('google', 'microsoft'))
);
--> statement-breakpoint
CREATE TABLE "received_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" varchar(998) NOT NULL,
	"imap_uid" bigint,
	"sender" varchar(320) NOT NULL,
	"subject" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"folder" varchar(255) DEFAULT 'INBOX' NOT NULL,
	"spam_score" integer,
	"manual_classification" varchar(16),
	"read" boolean DEFAULT false NOT NULL,
	CONSTRAINT "received_message_manual_classification_check" CHECK ("received_message"."manual_classification" IS NULL OR "received_message"."manual_classification" IN ('spam', 'not_spam'))
);
--> statement-breakpoint
CREATE TABLE "send_counter" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sent_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" varchar(998) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"subject" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"smtp_response_code" varchar(32),
	CONSTRAINT "sent_message_status_check" CHECK ("sent_message"."status" IN ('delivered', 'bounced', 'pending'))
);
--> statement-breakpoint
CREATE TABLE "warmup_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"target_volume" integer NOT NULL,
	"actual_volume" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alias" ADD CONSTRAINT "alias_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_sent_message_id_sent_message_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."sent_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_rule" ADD CONSTRAINT "folder_rule_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_feedback" ADD CONSTRAINT "provider_feedback_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_message" ADD CONSTRAINT "received_message_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_counter" ADD CONSTRAINT "send_counter_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_message" ADD CONSTRAINT "sent_message_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warmup_plan" ADD CONSTRAINT "warmup_plan_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_keycloak_sub" ON "account" USING btree ("keycloak_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_alias_domain_source" ON "alias" USING btree ("domain_id","source");--> statement-breakpoint
CREATE INDEX "idx_attachment_sent_message" ON "attachment" USING btree ("sent_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_domain_name" ON "domain" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_domain_account_id" ON "domain" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "idx_folder_rule_mailbox_position" ON "folder_rule" USING btree ("mailbox_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mailbox_domain_local_part" ON "mailbox" USING btree ("domain_id","local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_feedback_domain_provider_date" ON "provider_feedback" USING btree ("domain_id","provider","date");--> statement-breakpoint
CREATE INDEX "idx_received_message_mailbox_folder" ON "received_message" USING btree ("mailbox_id","folder","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_received_message_mailbox_message_id" ON "received_message" USING btree ("mailbox_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_send_counter_account_day" ON "send_counter" USING btree ("account_id","day");--> statement-breakpoint
CREATE INDEX "idx_sent_message_mailbox" ON "sent_message" USING btree ("mailbox_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_warmup_plan_domain_day" ON "warmup_plan" USING btree ("domain_id","day");
--> statement-breakpoint
-- Hand-written: drizzle-kit does not emit views. Postfix and Dovecot read these and never
-- learn that `account` exists, so suspending an account cuts off mail and login in one write.
CREATE VIEW "v_postfix_domains" AS
	SELECT d."name"
	FROM "domain" d
	JOIN "account" a ON a."id" = d."account_id"
	WHERE d."active"
	  AND d."verified_at" IS NOT NULL
	  AND a."status" = 'active';
--> statement-breakpoint
-- Gated on verified_at too: authenticating is what reaches submission, so an unverified
-- domain left here could send before proving control.
CREATE VIEW "v_dovecot_users" AS
	SELECT m."local_part" || '@' || d."name" AS "email",
	       m."password_hash",
	       m."quota_mb"
	FROM "mailbox" m
	JOIN "domain" d  ON d."id" = m."domain_id"
	JOIN "account" a ON a."id" = d."account_id"
	WHERE m."active"
	  AND d."active"
	  AND d."verified_at" IS NOT NULL
	  AND a."status" = 'active';
--> statement-breakpoint
-- smtpd_sender_login_maps + reject_sender_login_mismatch. Without it, authenticating would
-- let one tenant send as another's verified domain, DKIM-signed by us.
CREATE VIEW "v_postfix_senders" AS
	SELECT m."local_part" || '@' || d."name" AS "email",
	       m."local_part" || '@' || d."name" AS "owner"
	FROM "mailbox" m
	JOIN "domain" d  ON d."id" = m."domain_id"
	JOIN "account" a ON a."id" = d."account_id"
	WHERE m."active"
	  AND d."active"
	  AND d."verified_at" IS NOT NULL
	  AND a."status" = 'active';
