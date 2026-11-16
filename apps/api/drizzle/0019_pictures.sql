CREATE TABLE `pictures` (
	`hash` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`has_text` integer DEFAULT false NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `picture_library` (
	`korean_key` text PRIMARY KEY NOT NULL,
	`korean` text NOT NULL,
	`meaning` text,
	`topic` text,
	`picture_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`picture_hash`) REFERENCES `pictures`(`hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `cards` ADD `picture` text;
