-- 014_task_priority.sql
-- Task priority (spec Proyek v2 R2): 1 high, 2 medium, 3 low, NULL none.
ALTER TABLE tasks ADD COLUMN priority INTEGER;

-- sync_items_update ignores updated_at, so the tasks trigger must watch priority itself
-- (012_sync.sql:73); otherwise a priority change never reaches sync_outbox.
DROP TRIGGER sync_tasks_update;
CREATE TRIGGER sync_tasks_update AFTER UPDATE ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.status IS NOT new.status OR old.project_id IS NOT new.project_id OR old.start_at IS NOT new.start_at OR old.tag IS NOT new.tag OR old.priority IS NOT new.priority)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
