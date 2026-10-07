"""Admin database (SQLite, stdlib only). Lives in admin/data/admin.db, which is git-ignored and never shipped."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipients (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id             INTEGER PRIMARY KEY,
  license_id     TEXT NOT NULL UNIQUE,          -- "lid" inside the key
  recipient_id   INTEGER NOT NULL REFERENCES recipients(id),
  device_id      TEXT NOT NULL,
  days           INTEGER NOT NULL,
  issued_on      TEXT NOT NULL,                 -- YYYY-MM-DD
  activate_by    TEXT NOT NULL,                 -- YYYY-MM-DD
  latest_expiry  TEXT NOT NULL,                 -- activate_by + days: the key can never run past this
  activated_on   TEXT,                          -- recorded by you when the recipient confirms (optional)
  key            TEXT NOT NULL,
  build_version  TEXT,                          -- installer version you sent with it
  amount         REAL,                          -- optional: what you charged
  currency       TEXT,
  notes          TEXT,
  revoked        INTEGER NOT NULL DEFAULT 0,    -- record-keeping only: offline keys cannot be switched off remotely
  renewal_of     INTEGER REFERENCES licenses(id),
  source         TEXT NOT NULL DEFAULT 'admin', -- admin | imported
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_licenses_recipient ON licenses(recipient_id);
CREATE INDEX IF NOT EXISTS ix_licenses_device ON licenses(device_id);

CREATE TABLE IF NOT EXISTS builds (
  id              INTEGER PRIMARY KEY,
  version         TEXT NOT NULL,
  hard_expiry     TEXT,
  options         TEXT,
  status          TEXT NOT NULL,                -- running | succeeded | failed | cancelled
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  duration_s      INTEGER,
  installer_path  TEXT,
  size_bytes      INTEGER,
  sha256          TEXT,
  git_commit      TEXT,
  log_file        TEXT NOT NULL,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  action  TEXT NOT NULL,
  detail  TEXT
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def all(self, sql: str, *params) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, params).fetchall()]

    def one(self, sql: str, *params) -> dict | None:
        with self.connect() as c:
            row = c.execute(sql, params).fetchone()
            return dict(row) if row else None

    def run(self, sql: str, *params) -> int:
        with self.connect() as c:
            return c.execute(sql, params).lastrowid

    def audit(self, action: str, detail: str = "") -> None:
        self.run("INSERT INTO audit (at, action, detail) VALUES (?, ?, ?)", now_iso(), action, detail)
