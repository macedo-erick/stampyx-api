ALTER TABLE "attachment" DROP CONSTRAINT "attachment_sent_message_id_sent_message_id_fk";
--> statement-breakpoint
DROP INDEX "idx_attachment_sent_message";--> statement-breakpoint
-- The send path never wrote this table, so it is empty; old rows keyed by sent_message_id
-- could not be mapped onto the new mailbox+message key anyway. Files already on disk are
-- untouched, only the pointers go.
DELETE FROM "attachment";--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "mailbox_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "message_id" varchar(998);--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attachment_mailbox_message" ON "attachment" USING btree ("mailbox_id","message_id");--> statement-breakpoint
ALTER TABLE "attachment" DROP COLUMN "sent_message_id";
