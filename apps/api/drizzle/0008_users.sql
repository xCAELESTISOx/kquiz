CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`webauthn_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_webauthn_id_unique` ON `users` (`webauthn_id`);
--> statement-breakpoint
INSERT INTO `users` (`id`, `name`, `role`, `webauthn_id`, `created_at`) VALUES (1, 'Владелец', 'owner', 'a3F1aXotb3duZXI', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
--> statement-breakpoint
CREATE TABLE `invites` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `auth_challenges` ADD `user_handle` text;
--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`korean` text NOT NULL,
	`korean_key` text NOT NULL,
	`meaning` text NOT NULL,
	`pronunciation` text,
	`romanization` text,
	`examples` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`speakable` integer NOT NULL,
	`source` text NOT NULL,
	`language` text DEFAULT 'ko' NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`introduced_at` integer,
	`introduction` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_cards` (`id`, `user_id`, `korean`, `korean_key`, `meaning`, `pronunciation`, `romanization`, `examples`, `notes`, `tags`, `speakable`, `source`, `language`, `suspended`, `introduced_at`, `introduction`, `created_at`, `updated_at`) SELECT `id`, 1, `korean`, `korean_key`, `meaning`, `pronunciation`, `romanization`, `examples`, `notes`, `tags`, `speakable`, `source`, `language`, `suspended`, `introduced_at`, `introduction`, `created_at`, `updated_at` FROM `cards`;
--> statement-breakpoint
DROP TABLE `cards`;
--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_user_korean_key` ON `cards` (`user_id`,`korean_key`);
--> statement-breakpoint
CREATE INDEX `cards_introduced` ON `cards` (`introduced_at`);
--> statement-breakpoint
CREATE TABLE `__new_sound_drills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`contrast` text NOT NULL,
	`words` text NOT NULL,
	`words_key` text NOT NULL,
	`source` text NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`wrong` integer DEFAULT 0 NOT NULL,
	`last_practiced_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sound_drills` (`id`, `user_id`, `contrast`, `words`, `words_key`, `source`, `correct`, `wrong`, `last_practiced_at`, `created_at`) SELECT `id`, 1, `contrast`, `words`, `words_key`, `source`, `correct`, `wrong`, `last_practiced_at`, `created_at` FROM `sound_drills`;
--> statement-breakpoint
DROP TABLE `sound_drills`;
--> statement-breakpoint
ALTER TABLE `__new_sound_drills` RENAME TO `sound_drills`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sound_drills_user_words` ON `sound_drills` (`user_id`,`words_key`);
--> statement-breakpoint
CREATE TABLE `__new_fsrs_settings` (
	`user_id` integer NOT NULL,
	`mode` text NOT NULL,
	`desired_retention` real DEFAULT 0.9 NOT NULL,
	`weights` text,
	`trained_on_reviews` integer,
	`optimized_at` integer,
	`checked_at` integer,
	`checked_on_reviews` integer,
	PRIMARY KEY(`user_id`, `mode`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fsrs_settings` (`user_id`, `mode`, `desired_retention`, `weights`, `trained_on_reviews`, `optimized_at`, `checked_at`, `checked_on_reviews`) SELECT 1, `mode`, `desired_retention`, `weights`, `trained_on_reviews`, `optimized_at`, `checked_at`, `checked_on_reviews` FROM `fsrs_settings`;
--> statement-breakpoint
DROP TABLE `fsrs_settings`;
--> statement-breakpoint
ALTER TABLE `__new_fsrs_settings` RENAME TO `fsrs_settings`;
--> statement-breakpoint
CREATE TABLE `__new_phone_stats` (
	`user_id` integer NOT NULL,
	`phone` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`last_seen` integer,
	PRIMARY KEY(`user_id`, `phone`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_phone_stats` (`user_id`, `phone`, `attempts`, `errors`, `last_seen`) SELECT 1, `phone`, `attempts`, `errors`, `last_seen` FROM `phone_stats`;
--> statement-breakpoint
DROP TABLE `phone_stats`;
--> statement-breakpoint
ALTER TABLE `__new_phone_stats` RENAME TO `phone_stats`;
--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_settings` (`user_id`, `key`, `value`) SELECT 1, `key`, `value` FROM `settings`;
--> statement-breakpoint
DROP TABLE `settings`;
--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;
--> statement-breakpoint
CREATE TABLE `__new_auth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`device_type` text,
	`backed_up` integer,
	`name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_auth_credentials` (`id`, `user_id`, `public_key`, `counter`, `transports`, `device_type`, `backed_up`, `name`, `created_at`, `last_used_at`) SELECT `id`, 1, `public_key`, `counter`, `transports`, `device_type`, `backed_up`, `name`, `created_at`, `last_used_at` FROM `auth_credentials`;
--> statement-breakpoint
DROP TABLE `auth_credentials`;
--> statement-breakpoint
ALTER TABLE `__new_auth_credentials` RENAME TO `auth_credentials`;
--> statement-breakpoint
CREATE TABLE `__new_auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`csrf_token` text NOT NULL,
	`credential_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_auth_sessions` (`token_hash`, `user_id`, `csrf_token`, `credential_id`, `created_at`, `expires_at`, `user_agent`) SELECT `token_hash`, 1, `csrf_token`, `credential_id`, `created_at`, `expires_at`, `user_agent` FROM `auth_sessions`;
--> statement-breakpoint
DROP TABLE `auth_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_auth_sessions` RENAME TO `auth_sessions`;
--> statement-breakpoint
CREATE TABLE `__new_oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_codes` (`code_hash`, `user_id`, `client_id`, `redirect_uri`, `code_challenge`, `scope`, `expires_at`) SELECT `code_hash`, 1, `client_id`, `redirect_uri`, `code_challenge`, `scope`, `expires_at` FROM `oauth_codes`;
--> statement-breakpoint
DROP TABLE `oauth_codes`;
--> statement-breakpoint
ALTER TABLE `__new_oauth_codes` RENAME TO `oauth_codes`;
--> statement-breakpoint
CREATE TABLE `__new_oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`access_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_hash` text NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`used_refresh_hashes` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_grants` (`id`, `user_id`, `client_id`, `scope`, `created_at`, `last_used_at`, `access_hash`, `access_expires_at`, `refresh_hash`, `refresh_expires_at`, `used_refresh_hashes`) SELECT `id`, 1, `client_id`, `scope`, `created_at`, `last_used_at`, `access_hash`, `access_expires_at`, `refresh_hash`, `refresh_expires_at`, `used_refresh_hashes` FROM `oauth_grants`;
--> statement-breakpoint
DROP TABLE `oauth_grants`;
--> statement-breakpoint
ALTER TABLE `__new_oauth_grants` RENAME TO `oauth_grants`;
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_access` ON `oauth_grants` (`access_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_refresh` ON `oauth_grants` (`refresh_hash`);