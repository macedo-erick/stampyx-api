-- A message sent to yourself is delivered to INBOX and appended to Sent with the same
-- Message-ID. Keyed without the folder, syncing one folder overwrote the other copy's row.
DROP INDEX "uq_received_message_mailbox_message_id";--> statement-breakpoint
-- Any row that was overwritten this way is a duplicate of a copy IMAP still holds; the next
-- listing rebuilds both sides from the server.
DELETE FROM "received_message" a
USING "received_message" b
WHERE a."mailbox_id" = b."mailbox_id"
  AND a."message_id" = b."message_id"
  AND a."folder" = b."folder"
  AND a."ctid" > b."ctid";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_received_message_mailbox_folder_message_id"
  ON "received_message" USING btree ("mailbox_id","folder","message_id");
