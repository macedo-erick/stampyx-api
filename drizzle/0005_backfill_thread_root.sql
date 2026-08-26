-- Rows written before thread_id existed have none, which would leave every old message in a
-- conversation of one. A message that started its own thread is its own root.
UPDATE "received_message" SET "thread_id" = "message_id" WHERE "thread_id" IS NULL;
