import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getDb, getDataDir } from "./db";

export interface Endpoint {
  type: "ollama" | "openai";
  host: string;
  port: number;
  url: string;
  name: string;
  available?: boolean;
  models?: string[];
}

export interface ShellmConfig {
  defaultModel: string;
  defaultAgent: string;
  endpoints: Endpoint[];
  dataDir: string;
  memoryEnabled: boolean;
  memoryMaxContext: number;
  nerdFonts: boolean;
  stream: boolean;
}

export function loadEnvFile(): void {
  const paths = [
    resolve(getDataDir(), ".env"),
    resolve(process.cwd(), ".env"),
    resolve(process.env.HOME || "", ".config/shellm/.env"),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
      break;
    }
  }
}

export function enumerateEndpoints(): Endpoint[] {
  const endpoints: Endpoint[] = [];

  // Enumerate OLLAMA_HOST_XX / OLLAMA_PORT_XX pairs
  for (let i = 0; i < 100; i++) {
    const suffix = String(i).padStart(2, "0");
    const host = process.env[`OLLAMA_HOST_${suffix}`];
    if (!host) break;
    const port = parseInt(process.env[`OLLAMA_PORT_${suffix}`] || "11434");
    const url = host.startsWith("http")
      ? host
      : `http://${host}:${port}`;
    endpoints.push({
      type: "ollama",
      host,
      port,
      url: url.replace(/\/$/, ""),
      name: `ollama-${suffix} (${host}:${port})`,
    });
  }

  // Enumerate OPENAI_COMPATIBLE_API_HOST_XX / _PORT_XX pairs
  for (let i = 0; i < 100; i++) {
    const suffix = String(i).padStart(2, "0");
    const host = process.env[`OPENAI_COMPATIBLE_API_HOST_${suffix}`];
    if (!host) break;
    const port = parseInt(
      process.env[`OPENAI_COMPATIBLE_API_PORT_${suffix}`] || "8000"
    );
    const url = host.startsWith("http")
      ? host
      : `http://${host}:${port}`;
    endpoints.push({
      type: "openai",
      host,
      port,
      url: url.replace(/\/$/, ""),
      name: `openai-${suffix} (${host}:${port})`,
    });
  }

  // Fallback: if no endpoints configured, add local ollama
  if (endpoints.length === 0) {
    endpoints.push({
      type: "ollama",
      host: "localhost",
      port: 11434,
      url: "http://localhost:11434",
      name: "ollama-local (localhost:11434)",
    });
  }

  return endpoints;
}

export function getConfig(): ShellmConfig {
  const db = getDb();
  const rows = db.query("SELECT key, value FROM config").all() as {
    key: string;
    value: string;
  }[];
  const dbCfg: Record<string, string> = {};
  for (const r of rows) dbCfg[r.key] = r.value;

  return {
    defaultModel:
      dbCfg.default_model ||
      process.env.SHELLM_DEFAULT_MODEL ||
      "gpt-oss:20b",
    defaultAgent:
      dbCfg.default_agent || process.env.AGENT_DEFAULT || "general",
    endpoints: enumerateEndpoints(),
    dataDir: getDataDir(),
    memoryEnabled:
      (dbCfg.memory_enabled || process.env.SHELLM_MEMORY_ENABLED) !== "false",
    memoryMaxContext: parseInt(
      dbCfg.memory_max_context ||
        process.env.SHELLM_MEMORY_MAX_CONTEXT ||
        "5"
    ),
    nerdFonts:
      (dbCfg.nerd_fonts || process.env.SHELLM_NERD_FONTS) !== "false",
    stream: (dbCfg.stream || process.env.SHELLM_STREAM) !== "false",
  };
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [key, value]
  );
}

export function hasEnvFile(): boolean {
  const paths = [
    resolve(getDataDir(), ".env"),
    resolve(process.cwd(), ".env"),
    resolve(process.env.HOME || "", ".config/shellm/.env"),
  ];
  return paths.some((p) => existsSync(p));
}

export function isConfigured(): boolean {
  const db = getDb();
  const count = db.query("SELECT COUNT(*) as c FROM agents").get() as {
    c: number;
  };
  return count.c > 0;
}
