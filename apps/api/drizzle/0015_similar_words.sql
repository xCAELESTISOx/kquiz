CREATE TABLE `similar_words` (
	`user_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`other_id` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `other_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`other_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `similar_words_other` ON `similar_words` (`other_id`);