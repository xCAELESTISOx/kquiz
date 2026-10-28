CREATE TABLE `voice_audio` (
	`text` text NOT NULL,
	`voice` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`text`, `voice`)
);
