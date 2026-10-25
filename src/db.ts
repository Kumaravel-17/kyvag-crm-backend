import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export const ROLES = ["admin", "manager", "rep"] as const;
export type Role = (typeof ROLES)[number];

// Timestamps are epoch milliseconds; booleans are 0/1 (SQLite has no boolean type)
export type UserRow = {
  id: string;
  email: string;
  name: string;
  title: string | null;
  phone: string | null;
  role: Role;
  password_hash: string | null; // null for an account that can't sign in yet
  failed_logins: number;
  locked_until: number | null;
  disabled: number;
  created_at: number;
  updated_at: number;
};

export type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  persistent: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
};

if (config.databasePath !== ":memory:") fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Only the SHA-256 of each token is stored, so a leaked database can't be used to sign in
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    title          TEXT,
    phone          TEXT,
    role           TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'rep')),
    password_hash  TEXT,
    failed_logins  INTEGER NOT NULL DEFAULT 0,
    locked_until   INTEGER,
    disabled       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persistent   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);


  CREATE TABLE IF NOT EXISTS password_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('reset', 'invite')),
    expires_at INTEGER NOT NULL
  );


  -- ---- CRM ----

  -- The pipeline, in order. "churned" is never stored here: it's an outcome, not a step.
  CREATE TABLE IF NOT EXISTS stages (
    id       TEXT PRIMARY KEY,
    label    TEXT NOT NULL,
    color    TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  -- A customer is a lead in the "paid" stage. stage isn't a foreign key: "churned" isn't a row in stages.
  CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY,           -- "L-2041"
    seq             INTEGER NOT NULL UNIQUE,    -- the number in the id, for issuing the next one
    name            TEXT NOT NULL,
    company         TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    domain          TEXT,
    city            TEXT,
    language        TEXT,
    source          TEXT NOT NULL,
    stage           TEXT NOT NULL,
    score           INTEGER NOT NULL DEFAULT 50,
    owner_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL DEFAULT 'None',
    store_size      TEXT,
    category        TEXT,
    tags            TEXT NOT NULL DEFAULT '[]', -- JSON array
    utm             TEXT,                       -- JSON object
    duplicates      TEXT NOT NULL DEFAULT '[]', -- JSON array of channels the same merchant also came from
    last_activity   TEXT,
    first_reply_min REAL,
    trial_day       INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    paid_at         INTEGER                     -- when the lead last moved to "paid"
  );
  CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage, created_at);
  CREATE INDEX IF NOT EXISTS leads_paid ON leads(paid_at);

  CREATE TABLE IF NOT EXISTS activities (
    id         TEXT PRIMARY KEY,
    lead_id    TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    author_id  TEXT REFERENCES users(id) ON DELETE SET NULL, -- null for entries the system logged
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activities_lead ON activities(lead_id, created_at);
`);

export const DEFAULT_STAGES = [
  { id: "new", label: "New", color: "info" },
  { id: "contacted", label: "Contacted", color: "accent" },
  { id: "demo", label: "Demo Booked", color: "aqua" },
  { id: "trial", label: "Trial", color: "warning" },
  { id: "paid", label: "Paid", color: "success" },
];

// A fresh database starts with the default pipeline
if ((db.prepare("SELECT COUNT(*) AS n FROM stages").get() as { n: number }).n === 0) {
  const insert = db.prepare("INSERT INTO stages (id, label, color, position) VALUES (?, ?, ?, ?)");
  db.transaction(() => DEFAULT_STAGES.forEach((s, i) => insert.run(s.id, s.label, s.color, i)))();
}

export function purgeExpired(now = Date.now()) {
  for (const table of ["sessions", "password_tokens"]) {
    db.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).run(now);
  }
}
