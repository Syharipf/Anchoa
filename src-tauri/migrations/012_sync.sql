-- Sync metadata contains no credentials or encryption keys.
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO sync_state (key, value) VALUES
  ('device_id', ''), -- db::migrate fills this once with a UUIDv7 in this transaction.
  ('user_id', ''),
  ('cursor', '0'),
  ('applying', '0'),
  ('last_sync_at', '0'),
  ('quota_bytes', '419430400');

CREATE TABLE sync_outbox (
  record_id  TEXT PRIMARY KEY,
  changed_at INTEGER NOT NULL
);
CREATE TABLE sync_pending (
  record_id TEXT PRIMARY KEY,
  version   TEXT NOT NULL,
  payload   BLOB
);
CREATE TABLE sync_versions (
  record_id TEXT PRIMARY KEY,
  version   TEXT NOT NULL
);

ALTER TABLE habit_checks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE habit_checks SET updated_at = COALESCE(deleted_at, created_at);

-- Use wall-clock milliseconds for every write, even when items.updated_at is
-- unchanged. Repeated writes coalesce to one outgoing record.

CREATE TRIGGER sync_items_insert AFTER INSERT ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND new.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_items_update AFTER UPDATE ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND new.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_items_delete AFTER DELETE ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND old.type IN ('task', 'project', 'account', 'transaction', 'bill', 'budget', 'habit', 'note', 'page')
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_tasks_insert AFTER INSERT ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_tasks_update AFTER UPDATE ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_tasks_delete AFTER DELETE ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_projects_insert AFTER INSERT ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_projects_update AFTER UPDATE ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_projects_delete AFTER DELETE ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_accounts_insert AFTER INSERT ON accounts
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_accounts_update AFTER UPDATE ON accounts
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_accounts_delete AFTER DELETE ON accounts
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_transactions_insert AFTER INSERT ON transactions
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_transactions_update AFTER UPDATE ON transactions
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_transactions_delete AFTER DELETE ON transactions
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_bills_insert AFTER INSERT ON bills
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_bills_update AFTER UPDATE ON bills
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_bills_delete AFTER DELETE ON bills
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_budgets_insert AFTER INSERT ON budgets
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_budgets_update AFTER UPDATE ON budgets
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_budgets_delete AFTER DELETE ON budgets
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habits_insert AFTER INSERT ON habits
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habits_update AFTER UPDATE ON habits
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habits_delete AFTER DELETE ON habits
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_journal_entries_insert AFTER INSERT ON journal_entries
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_journal_entries_update AFTER UPDATE ON journal_entries
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_journal_entries_delete AFTER DELETE ON journal_entries
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (old.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habit_checks_insert AFTER INSERT ON habit_checks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hc:' || new.habit_id || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habit_checks_update AFTER UPDATE ON habit_checks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hc:' || new.habit_id || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_habit_checks_delete AFTER DELETE ON habit_checks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hc:' || old.habit_id || ':' || old.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
