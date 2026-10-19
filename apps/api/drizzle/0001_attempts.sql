CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`score` integer NOT NULL,
	`target_phones` text NOT NULL,
	`heard_phones` text NOT NULL,
	`syllables` text NOT NULL,
	`errors_json` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_card` ON `attempts` (`card_id`,`created_at`);