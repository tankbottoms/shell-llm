import { existsSync, readFileSync, writeFileSync } from "fs";
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

export interface AgentEnvConfig {
  id: string;
  model: string;
  endpoint: string;
  provider: "ollama" | "openai";
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

const ENV_FILE_PATHS = [
  () => resolve(getDataDir(), ".env"),
  () => resolve(process.cwd(), ".env"),
  () => resolve(process.env.HOME || "", ".config/shellm/.env"),
];

function findEnvPath(): string | null {
  for (const pathFn of ENV_FILE_PATHS) {
    const p = pathFn();
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadEnvFile(): void {
  const p = findEnvPath();
  if (!p) return;

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

/**
 * Load per-agent model/endpoint/provider from env vars.
 * Pattern: SHELLM_AGENT_{ID}_MODEL, SHELLM_AGENT_{ID}_ENDPOINT, SHELLM_AGENT_{ID}_PROVIDER
 */
export function loadAgentConfigsFromEnv(): AgentEnvConfig[] {
  const configs: AgentEnvConfig[] = [];
  const seen = new Set<string>();

  // Scan all env vars for the pattern
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^SHELLM_AGENT_([A-Z0-9_]+)_MODEL$/);
    if (!match) continue;
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);

    const model = process.env[key] || "";
    const endpoint = process.env[`SHELLM_AGENT_${match[1]}_ENDPOINT`] || "";
    const provider = (process.env[`SHELLM_AGENT_${match[1]}_PROVIDER`] || "ollama") as "ollama" | "openai";

    if (model && endpoint) {
      configs.push({ id, model, endpoint, provider });
    }
  }

  return configs;
}

/**
 * Write agent configurations to the .env file.
 * Preserves existing non-agent content and replaces/adds the agent block.
 */
export function writeEnvAgents(
  agents: { id: string; model: string; endpoint: string; provider: string }[]
): void {
  const envPath = findEnvPath() || resolve(getDataDir(), ".env");

  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  // Remove existing agent config lines
  const lines = content.split("\n");
  const filtered: string[] = [];
  let inAgentBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of the agent block marker
    if (trimmed.includes("Agent-Model Mapping") || trimmed.includes("Agent Configuration")) {
      inAgentBlock = true;
      continue;
    }

    // Detect next section header (── ... ──) to end the agent block
    if (inAgentBlock && trimmed.startsWith("#") && trimmed.includes("──")) {
      inAgentBlock = false;
      filtered.push(line);
      continue;
    }

    // Skip individual agent env vars anywhere in the file
    if (/^SHELLM_AGENT_[A-Z0-9_]+_(MODEL|ENDPOINT|PROVIDER)=/.test(trimmed)) {
      continue;
    }
    // Skip commented-out agent env vars
    if (/^#\s*SHELLM_AGENT_[A-Z0-9_]+_(MODEL|ENDPOINT|PROVIDER)/.test(trimmed)) {
      continue;
    }

    if (!inAgentBlock) {
      filtered.push(line);
    }
  }

  // Build the agent block
  const agentLines: string[] = [
    "",
    "# ── Agent-Model Mapping ───────────────────────────────────────────",
    "# Each agent maps explicitly to a model, endpoint, and provider.",
    "# Set by 'shellm config' or edit directly.",
  ];

  for (const a of agents) {
    const ID = a.id.toUpperCase();
    agentLines.push(`SHELLM_AGENT_${ID}_MODEL=${a.model}`);
    agentLines.push(`SHELLM_AGENT_${ID}_ENDPOINT=${a.endpoint}`);
    agentLines.push(`SHELLM_AGENT_${ID}_PROVIDER=${a.provider}`);
  }

  // Find insertion point: after endpoint config, before settings
  let insertIdx = filtered.length;
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i].trim();
    if (t.includes("Settings") && t.includes("──")) {
      insertIdx = i;
      break;
    }
  }

  filtered.splice(insertIdx, 0, ...agentLines);

  writeFileSync(envPath, filtered.join("\n"));
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
  return findEnvPath() !== null;
}

export function isConfigured(): boolean {
  const db = getDb();
  const count = db.query("SELECT COUNT(*) as c FROM agents").get() as {
    c: number;
  };
  return count.c > 0;
}
