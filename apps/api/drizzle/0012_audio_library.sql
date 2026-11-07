-- Generated audio is a library by text: deleting or rewording a card keeps its recording in
-- speech_audio (the same default voice), so a card or example with that text later reuses it
-- instead of voicing it again. Foreign-key cascades fire these triggers too.
INSERT OR IGNORE INTO `speech_audio` (`text`, `mime`, `data`, `created_at`)
SELECT `text`, `mime`, `data`, `created_at` FROM `card_audio`;
--> statement-breakpoint
CREATE TRIGGER `card_audio_keep_on_delete` AFTER DELETE ON `card_audio`
BEGIN
  INSERT OR IGNORE INTO `speech_audio` (`text`, `mime`, `data`, `created_at`)
  VALUES (old.`text`, old.`mime`, old.`data`, old.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `card_audio_keep_on_update` AFTER UPDATE OF `text`, `data` ON `card_audio`
WHEN old.`text` <> new.`text`
BEGIN
  INSERT OR IGNORE INTO `speech_audio` (`text`, `mime`, `data`, `created_at`)
  VALUES (old.`text`, old.`mime`, old.`data`, old.`created_at`);
END;
