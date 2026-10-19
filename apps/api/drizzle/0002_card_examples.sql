ALTER TABLE `cards` ADD `examples` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `cards` SET `examples` = json_array(json_object('ko', `example_ko`, 'ru', coalesce(`example_meaning`, ''))) WHERE trim(coalesce(`example_ko`, '')) <> '';--> statement-breakpoint
ALTER TABLE `cards` DROP COLUMN `example_ko`;--> statement-breakpoint
ALTER TABLE `cards` DROP COLUMN `example_meaning`;
