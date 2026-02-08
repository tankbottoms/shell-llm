import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const DEFAULT_DATA_DIR = resolve(
  process.env.HOME || "~",
  ".local/store/shellm"
);

let _db: Database | null = null;

export function getDataDir(): string {
  const dir = process.env.SHELLM_DATA_DIR
    ? resolve(process.env.SHELLM_DATA_DIR.replace("~", process.env.HOME || ""))
    : DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): Database {
  if (_db) return _db;
  const dbPath = resolve(getDataDir(), "shellm.db");
  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shorthand TEXT UNIQUE,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id),
      directory TEXT NOT NULL,
      title TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      directory TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      directory TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_dir ON messages(directory);
    CREATE INDEX IF NOT EXISTS idx_memory_dir ON memory(directory);
    CREATE INDEX IF NOT EXISTS idx_sessions_dir ON sessions(directory);
  `);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
