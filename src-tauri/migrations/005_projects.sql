CREATE TABLE projects (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),  -- type='project', title=nama, body=deskripsi
  kind        TEXT NOT NULL,     -- app | document | research | personal
  deadline_at INTEGER,           -- 00:00 lokal, opsional
  repo_url    TEXT               -- opsional, sudah divalidasi
);

CREATE TABLE tasks (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),   -- type='task'
  status     TEXT NOT NULL,      -- plan | doing | done
  project_id TEXT REFERENCES items(id),               -- NULL = tugas lepas
  start_at   INTEGER,            -- rencana mulai, 00:00 lokal
  tag        TEXT                -- teks bebas
);

CREATE INDEX tasks_project ON tasks(project_id);

-- Notes with a due date become loose tasks (P1).
INSERT INTO tasks (item_id, status)
  SELECT id, CASE WHEN completed_at IS NULL THEN 'plan' ELSE 'done' END
  FROM items WHERE type = 'note' AND due_at IS NOT NULL;
UPDATE items SET type = 'task' WHERE type = 'note' AND due_at IS NOT NULL;
