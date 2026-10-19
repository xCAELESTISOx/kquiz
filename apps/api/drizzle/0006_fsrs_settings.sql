CREATE TABLE `fsrs_settings` (
	`mode` text PRIMARY KEY NOT NULL,
	`desired_retention` real DEFAULT 0.9 NOT NULL,
	`weights` text,
	`trained_on_reviews` integer,
	`optimized_at` integer,
	`checked_at` integer,
	`checked_on_reviews` integer
);
