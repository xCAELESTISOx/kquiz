ALTER TABLE `cards` ADD `learn_met_at` integer;
--> statement-breakpoint
UPDATE `cards` SET `learn_met_at` = `learning_at` WHERE `introduced_at` IS NULL AND `learning_at` IS NOT NULL AND (`learn_step` > 0 OR `learn_passed_at` IS NOT NULL);
