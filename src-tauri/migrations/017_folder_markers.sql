-- Folder customisation for the Files page: colour / emoji marker plus a bookmark.
-- Keyed by absolute folder path; local to this device, so it stays out of sync.
CREATE TABLE folder_markers (
    path TEXT PRIMARY KEY,
    emoji TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_folder_markers_pinned ON folder_markers (pinned, updated_at);
