CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cards` ADD `suspended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `introduced_at` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `introduction` text;--> statement-breakpoint
CREATE INDEX `cards_introduced` ON `cards` (`introduced_at`);--> statement-breakpoint
UPDATE `cards` SET `introduced_at` = `created_at`, `introduction` = 'direct';