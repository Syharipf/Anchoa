CREATE TABLE health_metrics (
  kind       TEXT NOT NULL CHECK (kind IN ('weight_g', 'sleep_min', 'steps', 'resting_hr')),
  date       TEXT NOT NULL,
  value      INTEGER NOT NULL CHECK (value >= 0),
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (kind, date)
);

CREATE INDEX idx_health_metrics_date ON health_metrics(date);

CREATE TRIGGER sync_health_metrics_insert AFTER INSERT ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || new.kind || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_health_metrics_update AFTER UPDATE ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.value IS NOT new.value OR old.note IS NOT new.note OR old.deleted_at IS NOT new.deleted_at)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || new.kind || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_health_metrics_delete AFTER DELETE ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || old.kind || ':' || old.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
