-- New words now wait to be learned before they enter reviews (newCards.ts). Cards that went in
-- under the old rules but were never reviewed go back to waiting, so the words just added aren't
-- asked about before they are learned. Their untouched schedules are all that is dropped.
DELETE FROM `review_states` WHERE `card_id` IN (
  SELECT `c`.`id` FROM `cards` `c`
  WHERE `c`.`introduced_at` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `review_log` `l` WHERE `l`.`card_id` = `c`.`id`)
    AND NOT EXISTS (SELECT 1 FROM `review_states` `s` WHERE `s`.`card_id` = `c`.`id` AND `s`.`reps` > 0)
);
--> statement-breakpoint
UPDATE `cards` SET `introduced_at` = NULL, `introduction` = NULL
WHERE `introduced_at` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `review_states` `s` WHERE `s`.`card_id` = `cards`.`id`);
