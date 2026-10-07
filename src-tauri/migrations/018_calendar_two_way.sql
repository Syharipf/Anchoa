-- Two-way Google Calendar synchronization (issue #184).
-- Links local task items with primary Google Calendar events.
CREATE TABLE calendar_task_links (
  item_id           TEXT PRIMARY KEY,
  google_event_id   TEXT NOT NULL UNIQUE,
  etag              TEXT NOT NULL DEFAULT '',
  google_updated    INTEGER NOT NULL DEFAULT 0,
  local_updated_at  INTEGER NOT NULL DEFAULT 0,
  deleted_at        INTEGER
);

CREATE INDEX calendar_task_links_event ON calendar_task_links(google_event_id);

ALTER TABLE calendar_sync ADD COLUMN sync_token TEXT NOT NULL DEFAULT '';
