ALTER TABLE `cards` ADD `kind` text DEFAULT 'word' NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `parts` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `register` text;