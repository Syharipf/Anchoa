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
UPDATE habit_checks SET updated_at = COALESCE(deleted_at, created_at) WHERE updated_at = 0; -- every row: the column was just added with 0

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

-- Only real changes to synced columns create a version: local-only columns
-- (opened_at) and bare updated_at bumps would otherwise ship stale content as newer.
CREATE TRIGGER sync_items_update
AFTER UPDATE OF type, title, body, parent_id, due_at, completed_at, created_at, updated_at, deleted_at ON items
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.type IS NOT new.type OR old.title IS NOT new.title OR old.body IS NOT new.body OR old.parent_id IS NOT new.parent_id OR old.due_at IS NOT new.due_at OR old.completed_at IS NOT new.completed_at OR old.created_at IS NOT new.created_at OR old.deleted_at IS NOT new.deleted_at)
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
  AND (old.item_id IS NOT new.item_id OR old.status IS NOT new.status OR old.project_id IS NOT new.project_id OR old.start_at IS NOT new.start_at OR old.tag IS NOT new.tag)
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

-- agent, agent_command and agent_dir are per-device and stay local.
CREATE TRIGGER sync_projects_update AFTER UPDATE OF item_id, kind, deadline_at, repo_url ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.deadline_at IS NOT new.deadline_at OR old.repo_url IS NOT new.repo_url)
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
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.currency IS NOT new.currency OR old.opening_balance IS NOT new.opening_balance)
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
  AND (old.item_id IS NOT new.item_id OR old.account_id IS NOT new.account_id OR old.amount IS NOT new.amount OR old.category IS NOT new.category OR old.occurred_at IS NOT new.occurred_at OR old.transfer_id IS NOT new.transfer_id OR old.bill_id IS NOT new.bill_id)
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
  AND (old.item_id IS NOT new.item_id OR old.account_id IS NOT new.account_id OR old.amount IS NOT new.amount OR old.repeat IS NOT new.repeat OR old.due_day IS NOT new.due_day)
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
  AND (old.item_id IS NOT new.item_id OR old.category IS NOT new.category OR old.amount IS NOT new.amount)
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
  AND (old.item_id IS NOT new.item_id OR old.days IS NOT new.days OR old.remind_at IS NOT new.remind_at OR old.remind_on IS NOT new.remind_on OR old.auto_journal IS NOT new.auto_journal)
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
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.mood IS NOT new.mood OR old.tags IS NOT new.tags OR old.task_id IS NOT new.task_id)
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
  AND (old.habit_id IS NOT new.habit_id OR old.date IS NOT new.date OR old.created_at IS NOT new.created_at OR old.deleted_at IS NOT new.deleted_at)
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
