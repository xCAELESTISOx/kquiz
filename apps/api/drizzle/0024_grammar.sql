-- Grammar mode: constructions with their sentences, similar pairs, schedule and answers.
CREATE TABLE `grammar_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`pattern` text NOT NULL,
	`meaning` text NOT NULL,
	`goal` text DEFAULT 'use' NOT NULL,
	`explanation` text,
	`trap` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`learning_at` integer,
	`learn_step` integer DEFAULT 0 NOT NULL,
	`learn_passed_at` integer,
	`learned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grammar_points_user_pattern` ON `grammar_points` (`user_id`,`pattern`);
--> statement-breakpoint
CREATE TABLE `grammar_sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`point_id` integer NOT NULL REFERENCES `grammar_points`(`id`) ON DELETE cascade,
	`before` text NOT NULL,
	`after` text DEFAULT '' NOT NULL,
	`lemma` text,
	`pos` text,
	`cls` text,
	`pattern` text,
	`final` text,
	`translation` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grammar_sentences_point` ON `grammar_sentences` (`point_id`);
--> statement-breakpoint
CREATE TABLE `grammar_similar` (
	`point_id` integer NOT NULL REFERENCES `grammar_points`(`id`) ON DELETE cascade,
	`other_id` integer NOT NULL REFERENCES `grammar_points`(`id`) ON DELETE cascade,
	`note` text,
	PRIMARY KEY(`point_id`, `other_id`)
);
--> statement-breakpoint
CREATE TABLE `grammar_states` (
	`point_id` integer PRIMARY KEY NOT NULL REFERENCES `grammar_points`(`id`) ON DELETE cascade,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`state` integer NOT NULL,
	`last_review` integer
);
--> statement-breakpoint
CREATE INDEX `grammar_states_due` ON `grammar_states` (`due`);
--> statement-breakpoint
CREATE TABLE `grammar_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`point_id` integer NOT NULL REFERENCES `grammar_points`(`id`) ON DELETE cascade,
	`sentence_id` integer,
	`task` text NOT NULL,
	`phase` text NOT NULL,
	`outcome` text NOT NULL,
	`cls` text,
	`answered_at` integer NOT NULL,
	`elapsed_ms` integer
);
--> statement-breakpoint
CREATE INDEX `grammar_answers_user` ON `grammar_answers` (`user_id`,`answered_at`);
--> statement-breakpoint
CREATE INDEX `grammar_answers_point` ON `grammar_answers` (`point_id`);
