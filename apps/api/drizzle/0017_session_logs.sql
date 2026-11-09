CREATE TABLE `session_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_logs_user` ON `session_logs` (`user_id`,`started_at`);