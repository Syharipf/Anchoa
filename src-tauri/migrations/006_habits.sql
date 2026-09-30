CREATE TABLE habits (
  item_id   TEXT PRIMARY KEY REFERENCES items(id),  -- type='habit', title=nama
  days      INTEGER NOT NULL DEFAULT 127,           -- bit 0 = Senin … bit 6 = Minggu
  remind_at TEXT,                                   -- "HH:MM" waktu lokal, opsional
  remind_on INTEGER NOT NULL DEFAULT 0              -- 0/1
);

CREATE TABLE habit_checks (
  habit_id   TEXT NOT NULL REFERENCES items(id),
  date       TEXT NOT NULL,     -- "YYYY-MM-DD" lokal
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (habit_id, date)
);
