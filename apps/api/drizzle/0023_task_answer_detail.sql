-- Word scores (wordScore.ts) need more of each answer: which part of the session it was in, whether
-- it was right only with a hint or slowly, and whether a miss was put right on the spot. The rows
-- are filled in again from the session logs at start (backfillTaskAnswers).
ALTER TABLE `task_answers` ADD `phase` text;
--> statement-breakpoint
ALTER TABLE `task_answers` ADD `soft` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `task_answers` ADD `recovered` integer DEFAULT false NOT NULL;
