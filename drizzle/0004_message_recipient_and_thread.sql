ALTER TABLE "received_message" ADD COLUMN "recipient" varchar(320);--> statement-breakpoint
ALTER TABLE "received_message" ADD COLUMN "in_reply_to" varchar(998);--> statement-breakpoint
ALTER TABLE "received_message" ADD COLUMN "thread_id" varchar(998);--> statement-breakpoint
CREATE INDEX "idx_received_message_thread" ON "received_message" USING btree ("mailbox_id","thread_id");