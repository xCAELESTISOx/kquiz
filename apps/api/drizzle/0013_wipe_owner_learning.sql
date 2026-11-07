-- One-time fresh start for the owner (user 1), asked for on 2026-11-07: their cards and phrases,
-- review history, schedules, FSRS parameters, sound statistics and drills go. Their account,
-- passkeys, Claude connector, settings and other people's data stay, and so does every generated
-- recording (kept in speech_audio by 0012), so words added again don't need voicing again.
-- Foreign keys are off while migrating (db/client.ts), so children are deleted explicitly.
-- update.sh backs the database up before the new API starts and runs this.
DELETE FROM `attempts` WHERE `card_id` IN (SELECT `id` FROM `cards` WHERE `user_id` = 1);
--> statement-breakpoint
DELETE FROM `review_log` WHERE `card_id` IN (SELECT `id` FROM `cards` WHERE `user_id` = 1);
--> statement-breakpoint
DELETE FROM `review_states` WHERE `card_id` IN (SELECT `id` FROM `cards` WHERE `user_id` = 1);
--> statement-breakpoint
DELETE FROM `card_audio` WHERE `card_id` IN (SELECT `id` FROM `cards` WHERE `user_id` = 1);
--> statement-breakpoint
DELETE FROM `cards` WHERE `user_id` = 1;
--> statement-breakpoint
DELETE FROM `phone_stats` WHERE `user_id` = 1;
--> statement-breakpoint
DELETE FROM `sound_drills` WHERE `user_id` = 1;
--> statement-breakpoint
DELETE FROM `fsrs_settings` WHERE `user_id` = 1;
