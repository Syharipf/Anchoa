CREATE TABLE contributions (
  date  TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

CREATE TABLE github_sync (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  login      TEXT NOT NULL,
  fetched_on TEXT NOT NULL
);
