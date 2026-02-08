#!/usr/bin/env bun
// Quick seed script to set up agents with known endpoints

import { loadEnvFile } from "./config";
import { getDb } from "./db";
import { seedDefaultAgents, upsertAgent } from "./agents";
import { setConfig } from "./config";

loadEnvFile();

// Default: qwen2.5:3b on localhost for quick queries
seedDefaultAgents("http://localhost:11434", "qwen2.5:3b", "ollama");
setConfig("default_model", "qwen2.5:3b");

// Thinking agent: Qwen3-32B-AWQ on spark-1 vLLM
upsertAgent({
  id: "thinking",
  name: "Deep Thinking (spark-1 vLLM)",
  shorthand: "t",
  provider: "openai",
  endpoint: "http://spark-1.local:8006",
  model: "Qwen3-32B-AWQ",
  systemPrompt:
    "You are a deep thinking assistant. Take your time to reason through problems carefully. Break down complex topics into understandable parts. Show your reasoning process. Consider edge cases and implications.",
  isDefault: false,
});

// Worker/coding agent: Qwen3-32B-AWQ on spark-2 vLLM
upsertAgent({
  id: "worker",
  name: "Coding Worker (spark-2 vLLM)",
  shorthand: "w",
  provider: "openai",
  endpoint: "http://spark-2.local:8007",
  model: "Qwen3-32B-AWQ",
  systemPrompt:
    "You are an expert programmer and coding assistant. Provide clean, working code with minimal explanation. Use proper formatting for code blocks. Focus on correctness, efficiency, and best practices. When showing commands, make them copy-pasteable.",
  isDefault: false,
});

// Research on spark-1 Ollama with deepseek-r1
upsertAgent({
  id: "research",
  name: "Research (spark-1 deepseek-r1)",
  shorthand: "r",
  provider: "ollama",
  endpoint: "http://spark-1.local:11434",
  model: "deepseek-r1:latest",
  systemPrompt:
    "You are a thorough research and analysis assistant. Think step by step through complex problems. Provide well-reasoned, comprehensive answers. Cite your reasoning. Consider multiple perspectives and trade-offs.",
  isDefault: false,
});

console.log("Agents seeded successfully.");

// List what we set up
const db = getDb();
const agents = db.query("SELECT id, name, shorthand, provider, endpoint, model, is_default FROM agents ORDER BY is_default DESC, id").all() as any[];
for (const a of agents) {
  const def = a.is_default ? " *" : "";
  console.log(`  [${a.shorthand}] ${a.name}${def} -> ${a.provider}://${a.endpoint} (${a.model})`);
}
