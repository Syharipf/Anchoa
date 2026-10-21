-- 1. Tabel ekstensi
CREATE TABLE media (
  item_id        TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('film', 'series', 'anime', 'book', 'manga')),
  status         TEXT NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'active', 'finished', 'dropped')),
  progress       INTEGER,
  progress_total INTEGER,
  rating         INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  started_at     INTEGER,
  finished_at    INTEGER,
  year           INTEGER,
  creator        TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',
  CHECK (progress IS NULL OR progress >= 0),
  CHECK (progress_total IS NULL OR progress_total > 0),
  CHECK (progress IS NULL OR progress_total IS NULL OR progress <= progress_total)
);

CREATE INDEX idx_media_status_kind ON media(status, kind);

-- 2. sync_items_* di-drop lalu dibuat ulang dengan 'media' di daftar tipe.
DROP TRIGGER IF EXISTS sync_items_insert;
DROP TRIGGER IF EXISTS sync_items_update;
DROP TRIGGER IF EXISTS sync_items_delete;

CREATE TRIGGER sync_items_insert AFTER INSERT ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND new.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page', 'media')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_items_update
AFTER UPDATE OF type, title, body, parent_id, due_at, completed_at, created_at, updated_at, deleted_at ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.type IS NOT new.type OR old.title IS NOT new.title OR old.body IS NOT new.body OR old.parent_id IS NOT new.parent_id OR old.due_at IS NOT new.due_at OR old.completed_at IS NOT new.completed_at OR old.created_at IS NOT new.created_at OR old.deleted_at IS NOT new.deleted_at)
  AND new.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page', 'media')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_items_delete AFTER DELETE ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND old.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page', 'media')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

-- 3. Enqueue untuk tulisan di tabel ekstensi media
CREATE TRIGGER sync_media_insert AFTER INSERT ON media
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_media_update AFTER UPDATE ON media
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.status IS NOT new.status OR old.progress IS NOT new.progress OR old.progress_total IS NOT new.progress_total OR old.rating IS NOT new.rating OR old.started_at IS NOT new.started_at OR old.finished_at IS NOT new.finished_at OR old.year IS NOT new.year OR old.creator IS NOT new.creator OR old.tags IS NOT new.tags)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_media_delete AFTER DELETE ON media
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
