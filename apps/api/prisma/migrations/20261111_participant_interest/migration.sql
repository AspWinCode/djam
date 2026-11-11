DO $$ BEGIN
  CREATE TYPE "ParticipantInterest" AS ENUM ('continue_learning', 'not_interested');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "participants"
ADD COLUMN IF NOT EXISTS "interest_prompt_opened_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "interest_response" "ParticipantInterest",
ADD COLUMN IF NOT EXISTS "interest_responded_at" TIMESTAMP(3);
