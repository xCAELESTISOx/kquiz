-- New words wait in a pool and are learned a few at a time before they enter reviews (newCards.ts).
ALTER TABLE `cards` ADD `learning_at` integer;
--> statement-breakpoint
ALTER TABLE `cards` ADD `learn_step` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `cards` ADD `learn_passed_at` integer;
--> statement-breakpoint
-- Cards that went in under the old rules but were never reviewed go back to the pool, so the words
-- just added aren't asked about before they are learned. Their untouched schedules are all that goes.
DELETE FROM `review_states` WHERE `card_id` IN (
  SELECT `c`.`id` FROM `cards` `c`
  WHERE `c`.`introduced_at` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `review_log` `l` WHERE `l`.`card_id` = `c`.`id`)
    AND NOT EXISTS (SELECT 1 FROM `review_states` `s` WHERE `s`.`card_id` = `c`.`id` AND `s`.`reps` > 0)
);
--> statement-breakpoint
UPDATE `cards` SET `introduced_at` = NULL, `introduction` = NULL
WHERE `introduced_at` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `review_states` `s` WHERE `s`.`card_id` = `cards`.`id`);
