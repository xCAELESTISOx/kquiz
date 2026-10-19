CREATE TABLE `sound_drills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contrast` text NOT NULL,
	`words` text NOT NULL,
	`words_key` text NOT NULL,
	`source` text NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`wrong` integer DEFAULT 0 NOT NULL,
	`last_practiced_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sound_drills_words` ON `sound_drills` (`words_key`);--> statement-breakpoint
CREATE TABLE `speech_audio` (
	`text` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL
);
