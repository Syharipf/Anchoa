ALTER TABLE journal_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- Pin changes must enqueue the note even when no other journal field changes.
DROP TRIGGER sync_journal_entries_update;
CREATE TRIGGER sync_journal_entries_update AFTER UPDATE ON journal_entries
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.mood IS NOT new.mood OR old.tags IS NOT new.tags OR old.task_id IS NOT new.task_id OR old.pinned IS NOT new.pinned)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
