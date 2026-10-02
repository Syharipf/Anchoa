CREATE TABLE emails (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  folder      TEXT NOT NULL,
  uid         INTEGER NOT NULL CHECK (uid > 0),
  message_id  TEXT,
  from_name   TEXT NOT NULL DEFAULT '',
  from_addr   TEXT NOT NULL DEFAULT '',
  to_addrs    TEXT NOT NULL DEFAULT '[]',
  sent_at     INTEGER NOT NULL DEFAULT 0,
  unread      INTEGER NOT NULL DEFAULT 1 CHECK (unread IN (0, 1)),
  starred     INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  has_html    INTEGER NOT NULL DEFAULT 0 CHECK (has_html IN (0, 1)),
  body_cached INTEGER NOT NULL DEFAULT 0 CHECK (body_cached IN (0, 1)),
  refs        TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX emails_folder_uid ON emails(folder, uid);
CREATE INDEX emails_folder_sent ON emails(folder, sent_at DESC);
