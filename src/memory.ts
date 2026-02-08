import { getDb } from "./db";

interface MemoryEntry {
  id: number;
  directory: string;
  question: string;
  answer: string;
  keywords: string;
  createdAt: string;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some",
    "such", "no", "nor", "not", "only", "own", "same", "so", "than",
    "too", "very", "just", "because", "but", "and", "or", "if", "while",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "it", "its", "they", "them", "their",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function similarity(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

export function storeMemory(
  directory: string,
  question: string,
  answer: string
): void {
  const db = getDb();
  const keywords = extractKeywords(question + " " + answer).join(",");
  db.prepare(
    "INSERT INTO memory (directory, question, answer, keywords) VALUES (?, ?, ?, ?)"
  ).run(directory, question, answer, keywords);
}

export function getRelevantMemory(
  directory: string,
  question: string,
  maxResults: number = 5
): MemoryEntry[] {
  const db = getDb();
  const queryKeywords = extractKeywords(question);

  // Get recent memories from this directory
  const rows = db
    .query(
      `SELECT * FROM memory WHERE directory = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(directory) as any[];

  if (rows.length === 0) return [];

  // Score by keyword overlap
  const scored = rows
    .map((r) => ({
      entry: {
        id: r.id,
        directory: r.directory,
        question: r.question,
        answer: r.answer,
        keywords: r.keywords || "",
        createdAt: r.created_at,
      },
      score: similarity(queryKeywords, (r.keywords || "").split(",")),
    }))
    .filter((s) => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map((s) => s.entry);
}

export function formatMemoryContext(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";
  let ctx = "Relevant previous interactions in this directory:\n\n";
  for (const m of memories) {
    ctx += `Q: ${m.question}\nA: ${m.answer.slice(0, 200)}${m.answer.length > 200 ? "..." : ""}\n\n`;
  }
  return ctx;
}

export function getMemoryCount(directory: string): number {
  const db = getDb();
  const row = db
    .query("SELECT COUNT(*) as c FROM memory WHERE directory = ?")
    .get(directory) as { c: number };
  return row.c;
}
