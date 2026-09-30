-- Fase 2: accounts, transactions, bills and the monthly limit. Each row
-- extends an `items` row with the same id (spec Fase 2 §3).
CREATE TABLE accounts (
  item_id         TEXT PRIMARY KEY REFERENCES items(id),
  kind            TEXT NOT NULL,              -- cash | bank | ewallet | credit
  currency        TEXT NOT NULL DEFAULT 'IDR',
  opening_balance INTEGER NOT NULL DEFAULT 0  -- rupiah
);

CREATE TABLE transactions (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  account_id  TEXT NOT NULL REFERENCES items(id),
  amount      INTEGER NOT NULL,          -- rupiah; negative = money leaving the account
  category    TEXT,                      -- NULL = no category; always NULL for transfers
  occurred_at INTEGER NOT NULL,          -- local midnight of the date, epoch ms UTC
  transfer_id TEXT,                      -- shared by both legs of a transfer
  bill_id     TEXT REFERENCES items(id)  -- set when recorded by "Tandai lunas"
);

CREATE TABLE bills (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  account_id TEXT NOT NULL REFERENCES items(id),
  amount     INTEGER NOT NULL,  -- rupiah, positive
  repeat     TEXT NOT NULL,     -- once | monthly
  due_day    INTEGER NOT NULL   -- original day of month, 1-31
);

CREATE TABLE budgets (
  item_id  TEXT PRIMARY KEY REFERENCES items(id),
  category TEXT,             -- NULL = the total monthly limit (the only kind in Fase 2)
  amount   INTEGER NOT NULL  -- rupiah per month, positive
);

CREATE INDEX transactions_account  ON transactions(account_id);
CREATE INDEX transactions_occurred ON transactions(occurred_at);
CREATE INDEX transactions_transfer ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX transactions_bill     ON transactions(bill_id)     WHERE bill_id IS NOT NULL;
