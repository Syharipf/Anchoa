-- Google Calendar (read-only pull). Tokens never live here: they go to the OS
-- keyring. This table is only the event cache that the schedule reads.
CREATE TABLE calendar_sync (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  account     TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  last_error  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE calendar_events (
  event_id  TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  start_at  INTEGER NOT NULL,
  end_at    INTEGER NOT NULL
);

CREATE INDEX calendar_events_start ON calendar_events(start_at);