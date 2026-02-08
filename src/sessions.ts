import { getDb } from "./db";
import type { ChatMessage } from "./llm/client";

export interface Session {
  id: string;
  agentId: string;
  directory: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createSession(
  agentId: string,
  directory: string,
  title?: string
): string {
  const db = getDb();
  const id = genId();
  db.prepare(
    "INSERT INTO sessions (id, agent_id, directory, title) VALUES (?, ?, ?, ?)"
  ).run(id, agentId, directory, title || null);
  return id;
}

export function addMessage(
  sessionId: string,
  role: string,
  content: string,
  directory: string,
  tokensIn = 0,
  tokensOut = 0,
  durationMs = 0
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (session_id, role, content, directory, tokens_in, tokens_out, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, role, content, directory, tokensIn, tokensOut, durationMs);
  db.prepare(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  const db = getDb();
  const rows = db
    .query(
      "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id"
    )
    .all(sessionId) as { role: string; content: string }[];
  return rows.map((r) => ({
    role: r.role as "system" | "user" | "assistant",
    content: r.content,
  }));
}

export function listSessions(
  directory?: string,
  limit = 20
): Session[] {
  const db = getDb();
  let query: string;
  let params: any[];

  if (directory) {
    query = `SELECT s.*, COUNT(m.id) as message_count
             FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
             WHERE s.directory = ?
             GROUP BY s.id
             ORDER BY s.updated_at DESC LIMIT ?`;
    params = [directory, limit];
  } else {
    query = `SELECT s.*, COUNT(m.id) as message_count
             FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
             GROUP BY s.id
             ORDER BY s.updated_at DESC LIMIT ?`;
    params = [limit];
  }

  const rows = db.query(query).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    directory: r.directory,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
  }));
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const r = db
    .query("SELECT * FROM sessions WHERE id = ?")
    .get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    agentId: r.agent_id,
    directory: r.directory,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, id);
}
