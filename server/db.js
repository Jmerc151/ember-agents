import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'ember-agents.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'backlog' CHECK(status IN ('backlog','todo','in_progress','in_review','done','failed')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    agent_id TEXT,
    output TEXT DEFAULT '',
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info' CHECK(type IN ('info','success','error','warning','output')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_avatar TEXT DEFAULT '',
    sender_color TEXT DEFAULT '',
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

export default db
