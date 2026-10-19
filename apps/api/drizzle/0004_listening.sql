-- Listening mode: every existing card gets a fresh schedule, as new cards do in cardStore.ts.
INSERT OR IGNORE INTO `review_states` (`card_id`, `mode`, `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`)
SELECT `id`, 'listening', CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0, 0, 0, 0, 0, 0, 0, 0, NULL FROM `cards`;
