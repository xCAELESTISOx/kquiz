-- Single words read by M1 could be said twice ("옷 … 옷"); the scorer now catches that, so they
-- are made again. Only extra voices: the app plays F1 meanwhile, so nothing goes silent.
DELETE FROM `voice_audio` WHERE `voice` = 'M1' AND instr(trim(`text`), ' ') = 0;
