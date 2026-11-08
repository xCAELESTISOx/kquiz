-- Pronunciation is stored bare (익따); the app adds the brackets. Some cards came in as "[아래]"
-- and showed "[[아래]]", and a pronunciation equal to the spelling says nothing, so it goes.
UPDATE `cards` SET `pronunciation` = trim(`pronunciation`, '[] ') WHERE `pronunciation` IS NOT NULL;
--> statement-breakpoint
UPDATE `cards` SET `pronunciation` = NULL WHERE `pronunciation` = '' OR `pronunciation` = `korean`;
