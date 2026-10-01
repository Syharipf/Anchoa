CREATE TABLE links (
  from_id TEXT NOT NULL REFERENCES items(id),
  to_id   TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX links_to ON links(to_id);

CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO items_fts (item_id, title, body) SELECT id, title, body FROM items;

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (item_id, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE item_id = old.id;
END;
CREATE TRIGGER items_fts_update AFTER UPDATE OF title, body ON items BEGIN
  DELETE FROM items_fts WHERE item_id = old.id;
  INSERT INTO items_fts (item_id, title, body) VALUES (new.id, new.title, new.body);
END;
