CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  parent_id   TEXT REFERENCES items(id),
  due_at      INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  opened_at   INTEGER,
  deleted_at  INTEGER
);

CREATE INDEX items_due    ON items(due_at)    WHERE deleted_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX items_parent ON items(parent_id) WHERE deleted_at IS NULL;
