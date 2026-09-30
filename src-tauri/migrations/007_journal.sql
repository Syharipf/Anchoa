CREATE TABLE journal_entries (
  item_id TEXT PRIMARY KEY REFERENCES items(id),  -- items.type = 'note'
  kind    TEXT NOT NULL DEFAULT 'note',           -- idea | vent | note
  mood    INTEGER,                                -- 1–5, NULL = belum diisi
  tags    TEXT NOT NULL DEFAULT '',               -- "anchoa kuliah"
  task_id TEXT REFERENCES items(id)               -- tugas hasil "Jadikan tugas"
);

ALTER TABLE habits ADD COLUMN auto_journal INTEGER NOT NULL DEFAULT 0;
