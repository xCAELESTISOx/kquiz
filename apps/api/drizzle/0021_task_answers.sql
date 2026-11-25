CREATE TABLE `task_answers` (
	`log_id` text NOT NULL,
	`n` integer NOT NULL,
	`user_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`task` text NOT NULL,
	`missed` integer NOT NULL,
	`answered_at` integer NOT NULL,
	PRIMARY KEY(`log_id`, `n`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_answers_user` ON `task_answers` (`user_id`,`answered_at`);
