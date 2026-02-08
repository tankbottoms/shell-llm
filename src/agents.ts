import { getDb } from "./db";
import { loadAgentConfigsFromEnv } from "./config";

export interface Agent {
  id: string;
  name: string;
  shorthand: string;
  provider: "ollama" | "openai";
  endpoint: string;
  model: string;
  systemPrompt: string;
  isDefault: boolean;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  general: `You are a helpful terminal assistant. Give concise, direct answers. When answering about shell commands, provide the command first, then a brief explanation. Format output for terminal readability.`,

  coding: `You are an expert programmer and coding assistant. Provide clean, working code with minimal explanation. Use proper formatting for code blocks. Focus on correctness, efficiency, and best practices. When showing commands, make them copy-pasteable.`,

  research: `You are a thorough research and analysis assistant. Think step by step through complex problems. Provide well-reasoned, comprehensive answers. Cite your reasoning. Consider multiple perspectives and trade-offs.`,

  thinking: `You are a deep thinking assistant. Take your time to reason through problems carefully. Break down complex topics into understandable parts. Show your reasoning process. Consider edge cases and implications.`,

  docs: `You are a documentation specialist. Provide clear, well-structured explanations. Use examples liberally. Format output with headers, lists, and code blocks for readability. Focus on accuracy and completeness.`,
};

const AGENT_NAMES: Record<string, string> = {
  general: "General Assistant",
  coding: "Coding Assistant",
  research: "Research / Thinking",
  thinking: "Deep Thinking",
  docs: "Documentation",
};

const AGENT_SHORTHANDS: Record<string, string> = {
  general: "g",
  coding: "c",
  research: "r",
  thinking: "t",
  docs: "d",
};

export function getSystemPrompt(agentType: string): string {
  return SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.general;
}

export function seedDefaultAgents(
  endpoint: string,
  model: string,
  provider: "ollama" | "openai" = "ollama"
): void {
  const db = getDb();
  const agents: Agent[] = [
    {
      id: "general",
      name: "General Assistant",
      shorthand: "g",
      provider,
      endpoint,
      model,
      systemPrompt: SYSTEM_PROMPTS.general,
      isDefault: true,
    },
    {
      id: "coding",
      name: "Coding Assistant",
      shorthand: "c",
      provider,
      endpoint,
      model,
      systemPrompt: SYSTEM_PROMPTS.coding,
      isDefault: false,
    },
    {
      id: "research",
      name: "Research / Thinking",
      shorthand: "r",
      provider,
      endpoint,
      model,
      systemPrompt: SYSTEM_PROMPTS.research,
      isDefault: false,
    },
    {
      id: "docs",
      name: "Documentation",
      shorthand: "d",
      provider,
      endpoint,
      model,
      systemPrompt: SYSTEM_PROMPTS.docs,
      isDefault: false,
    },
  ];

  const insert = db.prepare(
    `INSERT OR REPLACE INTO agents (id, name, shorthand, provider, endpoint, model, system_prompt, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const a of agents) {
    insert.run(a.id, a.name, a.shorthand, a.provider, a.endpoint, a.model, a.systemPrompt, a.isDefault ? 1 : 0);
  }
}

/**
 * Apply agent overrides from SHELLM_AGENT_* env vars.
 * This allows .env to be the source of truth for agent-model mapping.
 * Updates existing agents in the DB; creates new ones if they don't exist.
 */
export function applyEnvAgentOverrides(): void {
  const envConfigs = loadAgentConfigsFromEnv();
  if (envConfigs.length === 0) return;

  for (const ec of envConfigs) {
    const existing = getAgent(ec.id);
    if (existing) {
      // Update model/endpoint/provider from env, keep everything else
      upsertAgent({
        ...existing,
        model: ec.model,
        endpoint: ec.endpoint,
        provider: ec.provider,
      });
    } else {
      // Create a new agent from env config
      upsertAgent({
        id: ec.id,
        name: AGENT_NAMES[ec.id] || ec.id,
        shorthand: AGENT_SHORTHANDS[ec.id] || ec.id.charAt(0),
        provider: ec.provider,
        endpoint: ec.endpoint,
        model: ec.model,
        systemPrompt: getSystemPrompt(ec.id),
        isDefault: ec.id === "general",
      });
    }
  }
}

export function upsertAgent(agent: Agent): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO agents (id, name, shorthand, provider, endpoint, model, system_prompt, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(agent.id, agent.name, agent.shorthand, agent.provider, agent.endpoint, agent.model, agent.systemPrompt, agent.isDefault ? 1 : 0);
}

export function getAgent(idOrShorthand: string): Agent | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM agents WHERE id = ? OR shorthand = ? LIMIT 1")
    .get(idOrShorthand, idOrShorthand) as any;
  if (!row) return null;
  return rowToAgent(row);
}

export function getDefaultAgent(): Agent | null {
  const db = getDb();
  const row = db.query("SELECT * FROM agents WHERE is_default = 1 LIMIT 1").get() as any;
  if (!row) return null;
  return rowToAgent(row);
}

export function listAgents(): Agent[] {
  const db = getDb();
  const rows = db.query("SELECT * FROM agents ORDER BY is_default DESC, id").all() as any[];
  return rows.map(rowToAgent);
}

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    name: r.name,
    shorthand: r.shorthand,
    provider: r.provider,
    endpoint: r.endpoint,
    model: r.model,
    systemPrompt: r.system_prompt,
    isDefault: r.is_default === 1,
  };
}
