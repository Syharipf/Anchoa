ALTER TABLE projects ADD COLUMN agent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN agent_command TEXT;
ALTER TABLE projects ADD COLUMN agent_dir TEXT;

CREATE TABLE activities (
  item_id    TEXT PRIMARY KEY REFERENCES items(id), -- type='activity'
  task_id    TEXT REFERENCES items(id),
  project_id TEXT NOT NULL REFERENCES items(id),
  actor      TEXT NOT NULL,
  role       TEXT NOT NULL,
  kind       TEXT NOT NULL
);
CREATE INDEX activities_task ON activities(task_id);
CREATE INDEX activities_project ON activities(project_id);
