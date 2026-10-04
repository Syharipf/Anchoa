ALTER TABLE downloads ADD COLUMN expected_sha256 TEXT;
ALTER TABLE downloads ADD COLUMN actual_sha256 TEXT;
ALTER TABLE downloads ADD COLUMN first_interrupted_at INTEGER;
ALTER TABLE downloads ADD COLUMN next_retry_at INTEGER;
ALTER TABLE downloads ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS native_handoffs (
    request_id TEXT PRIMARY KEY,
    download_id TEXT NOT NULL,
    url TEXT NOT NULL,
    filename TEXT,
    referrer TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
