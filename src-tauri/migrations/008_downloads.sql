CREATE TABLE downloads (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),  -- type='download', title = judul/nama file
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'media' | 'file'
  options     TEXT NOT NULL DEFAULT '{}',-- JSON MediaOptions untuk media
  status      TEXT NOT NULL,             -- queued | running | paused | processing | done | failed
  total_bytes INTEGER,
  done_bytes  INTEGER NOT NULL DEFAULT 0,
  file_path   TEXT,                      -- hasil akhir
  error       TEXT,
  finished_at INTEGER
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
