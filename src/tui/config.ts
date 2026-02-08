import { c, g, banner, successMsg, infoMsg, hr, errorMsg } from "../format";
import {
  getConfig,
  setConfig,
  enumerateEndpoints,
} from "../config";
import { discoverAll, printDiscovery } from "../llm/discovery";
import { seedDefaultAgents, listAgents, upsertAgent } from "../agents";
import { ask, confirm, select } from "./prompts";

export async function runConfigWizard(firstRun = false): Promise<void> {
  console.log(`\n${banner()}\n`);

  if (firstRun) {
    console.log(
      `${infoMsg("First-time setup. Let's configure your LLM endpoints.")}\n`
    );
  } else {
    console.log(`${infoMsg("Current configuration:")}\n`);
    showCurrentConfig();
    console.log();
    const change = await confirm("Modify configuration?");
    if (!change) return;
  }

  // Discover endpoints
  console.log(`\n${infoMsg("Scanning configured endpoints...")}`);
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  printDiscovery(discovered);

  const online = discovered.filter((d) => d.available);
  if (online.length === 0) {
    console.log(errorMsg("No endpoints available. Check your .env or network."));
    console.log(
      `${c.dim}Configure OLLAMA_HOST_00/OLLAMA_PORT_00 or OPENAI_COMPATIBLE_API_HOST_00/_PORT_00 in .env${c.reset}`
    );
    return;
  }

  // Pick default model
  const allModels: { label: string; value: string; endpoint: string; provider: "ollama" | "openai" }[] = [];
  for (const ep of online) {
    for (const model of ep.models) {
      allModels.push({
        label: `${model} ${c.dim}on ${ep.name}${c.reset}`,
        value: model,
        endpoint: ep.url,
        provider: ep.type,
      });
    }
  }

  if (allModels.length === 0) {
    console.log(errorMsg("No models found on available endpoints."));
    return;
  }

  console.log(`\n${c.bold}Available models:${c.reset}\n`);
  for (let i = 0; i < allModels.length; i++) {
    console.log(`  ${c.bold}${i + 1}${c.reset}. ${allModels[i].label}`);
  }

  const modelIdx = parseInt(await ask("\nDefault model", "1")) - 1;
  const chosen = allModels[Math.max(0, Math.min(modelIdx, allModels.length - 1))];

  setConfig("default_model", chosen.value);

  // Seed agents with chosen model/endpoint
  seedDefaultAgents(chosen.endpoint, chosen.value, chosen.provider);

  // Show agents
  const agents = listAgents();
  console.log(`\n${c.bold}${g().robot} Configured agents:${c.reset}\n`);
  for (const a of agents) {
    const def = a.isDefault ? ` ${c.yellow}(default)${c.reset}` : "";
    console.log(
      `  ${c.cyan}${a.shorthand}${c.reset} ${c.bold}${a.name}${c.reset}${def}`
    );
    console.log(
      `    ${c.dim}${a.provider}://${a.endpoint} | model: ${a.model}${c.reset}`
    );
  }

  // Configure additional agents for remote endpoints
  for (const ep of online) {
    if (ep.url === chosen.endpoint) continue;
    const addRemote = await confirm(
      `\nAdd agent for ${ep.name}?`,
      true
    );
    if (!addRemote) continue;

    const remoteModel = ep.models[0] || chosen.value;
    const agentId = await ask("Agent ID (e.g. thinking, worker)", ep.name.split(" ")[0]);
    const agentName = await ask("Agent name", `${agentId} (${ep.host})`);
    const shorthand = await ask("Shorthand key", agentId.charAt(0));
    const role = await select("Agent role", [
      { label: "Coding", value: "coding" },
      { label: "Research / Thinking", value: "research" },
      { label: "General", value: "general" },
      { label: "Documentation", value: "docs" },
    ]);

    const PROMPTS: Record<string, string> = {
      general: "You are a helpful terminal assistant. Give concise, direct answers.",
      coding: "You are an expert programmer. Provide clean, working code with minimal explanation.",
      research: "You are a thorough research assistant. Think step by step through complex problems.",
      docs: "You are a documentation specialist. Provide clear, well-structured explanations.",
    };

    upsertAgent({
      id: agentId,
      name: agentName,
      shorthand,
      provider: ep.type,
      endpoint: ep.url,
      model: remoteModel,
      systemPrompt: PROMPTS[role] || PROMPTS.general,
      isDefault: false,
    });
  }

  // Memory settings
  const memEnabled = await confirm("\nEnable directory-based memory?", true);
  setConfig("memory_enabled", memEnabled ? "true" : "false");

  // Nerd fonts
  const nerd = await confirm("Use Iosevka Nerd Font glyphs?", true);
  setConfig("nerd_fonts", nerd ? "true" : "false");

  console.log(`\n${hr()}`);
  console.log(successMsg("Configuration saved."));
  console.log(
    `${c.dim}Data stored in: ${getConfig().dataDir}${c.reset}\n`
  );
}

function showCurrentConfig(): void {
  const cfg = getConfig();
  const gl = g();
  console.log(`  ${gl.database} ${c.bold}Data:${c.reset} ${cfg.dataDir}`);
  console.log(`  ${gl.robot} ${c.bold}Default model:${c.reset} ${cfg.defaultModel}`);
  console.log(`  ${gl.memory} ${c.bold}Memory:${c.reset} ${cfg.memoryEnabled ? "enabled" : "disabled"}`);
  console.log(`  ${gl.plug} ${c.bold}Endpoints:${c.reset} ${cfg.endpoints.length} configured`);

  const agents = listAgents();
  if (agents.length > 0) {
    console.log(`  ${gl.robot} ${c.bold}Agents:${c.reset}`);
    for (const a of agents) {
      const def = a.isDefault ? " *" : "";
      console.log(`    ${c.cyan}[${a.shorthand}]${c.reset} ${a.name}${def} ${c.dim}(${a.model})${c.reset}`);
    }
  }
}
