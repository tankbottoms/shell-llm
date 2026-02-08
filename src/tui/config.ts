import { c, g, banner, successMsg, infoMsg, hr, errorMsg, Spinner, formatDuration } from "../format";
import {
  getConfig,
  setConfig,
  enumerateEndpoints,
} from "../config";
import { discoverAll, printDiscovery, type DiscoveredEndpoint } from "../llm/discovery";
import { seedDefaultAgents, listAgents, upsertAgent, getSystemPrompt } from "../agents";
import { benchmarkModel, pickTestModel, isOomError, TEST_PROMPT } from "../benchmark";
import { ask, confirm, select } from "./prompts";

interface ModelOption {
  model: string;
  endpoint: string;
  endpointName: string;
  provider: "ollama" | "openai";
  durationMs?: number;
  tokPerSec?: number;
  tested: boolean;
}

export async function runConfigWizard(firstRun = false): Promise<void> {
  const gl = g();
  console.log(`\n${banner()}\n`);

  if (firstRun) {
    console.log(
      `${infoMsg("First-time setup. Let's discover and configure your LLM endpoints.")}\n`
    );
  } else {
    console.log(`${infoMsg("Current configuration:")}\n`);
    showCurrentConfig();
    console.log();

    const action = await select("What would you like to do?", [
      { label: "Re-run setup (discover + benchmark + assign)", value: "full" },
      { label: "Customize agent models", value: "agents" },
      { label: "Change settings (memory, fonts)", value: "settings" },
      { label: "Reset all agents to defaults", value: "reset" },
      { label: "Cancel", value: "cancel" },
    ]);

    if (action === "cancel") return;
    if (action === "settings") {
      await configureSettings();
      return;
    }
    if (action === "agents") {
      await customizeAgents();
      return;
    }
    if (action === "reset") {
      await resetAgents();
      return;
    }
    // "full" falls through to the full setup below
  }

  // ── Step 1: Discover endpoints ──────────────────────────────
  console.log(`\n${c.bold}Step 1/3: Discovering endpoints${c.reset}\n`);
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  printDiscovery(discovered);

  const online = discovered.filter((d) => d.available);
  if (online.length === 0) {
    console.log(errorMsg("\nNo endpoints available. Check your .env or network."));
    console.log(
      `${c.dim}Configure endpoints in ~/.local/store/shellm/.env${c.reset}`
    );
    console.log(
      `${c.dim}  OLLAMA_HOST_00=localhost  OLLAMA_PORT_00=11434${c.reset}`
    );
    console.log(
      `${c.dim}  OPENAI_COMPATIBLE_API_HOST_00=gpu-server  OPENAI_COMPATIBLE_API_PORT_00=8000${c.reset}`
    );
    return;
  }

  // ── Step 2: Benchmark ───────────────────────────────────────
  console.log(`\n${c.bold}Step 2/3: Benchmarking models${c.reset}`);
  console.log(`${c.dim}Testing one model per endpoint: "${TEST_PROMPT[1].content}"${c.reset}\n`);

  const results: ModelOption[] = [];
  const oomModels = new Set<string>();

  for (const ep of online) {
    const model = pickTestModel(ep);
    if (!model) {
      console.log(`  ${c.dim}${gl.cross} ${ep.name} - no models available${c.reset}`);
      continue;
    }

    if (oomModels.has(model) && ep.type === "ollama") {
      console.log(`  ${c.yellow}${gl.arrow}${c.reset} ${c.dim}${model} on ${ep.name} - skipped (OOM)${c.reset}`);
      continue;
    }

    const spinner = new Spinner(`testing ${model} on ${ep.name}...`);
    spinner.start();
    const bench = await benchmarkModel(ep.type, ep.url, model);
    spinner.stop();

    if (!bench.success && bench.error && isOomError(bench.error)) {
      oomModels.add(model);
      console.log(`  ${c.red}${gl.cross}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset} - OOM`);
      continue;
    }

    const tokPerSec = bench.tokensOut > 0 && bench.durationMs > 0
      ? (bench.tokensOut / bench.durationMs) * 1000 : 0;

    if (bench.success) {
      console.log(
        `  ${c.green}${gl.check}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset}` +
        ` - ${c.cyan}${formatDuration(bench.durationMs)}${c.reset}` +
        (tokPerSec > 0 ? ` (${tokPerSec.toFixed(1)} tok/s)` : "")
      );
      results.push({
        model, endpoint: ep.url, endpointName: ep.name,
        provider: ep.type, durationMs: bench.durationMs,
        tokPerSec, tested: true,
      });
    } else {
      console.log(
        `  ${c.red}${gl.cross}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset}` +
        ` - ${c.red}${bench.error || "no response"}${c.reset}`
      );
    }
  }

  if (results.length === 0) {
    console.log(errorMsg("\nNo models responded successfully. Check your endpoints."));
    return;
  }

  // Sort by speed (fastest first)
  results.sort((a, b) => (a.durationMs || Infinity) - (b.durationMs || Infinity));

  // ── Step 3: Auto-assign agents ──────────────────────────────
  console.log(`\n${c.bold}Step 3/3: Assigning models to agents${c.reset}\n`);

  const fastest = results[0];
  const slowest = results.length > 1 ? results[results.length - 1] : fastest;
  const middle = results.length > 2 ? results[1] : fastest;

  // Build agent assignments
  const assignments: {
    id: string; name: string; shorthand: string; role: string;
    model: string; endpoint: string; endpointName: string;
    provider: "ollama" | "openai"; isDefault: boolean;
    durationMs?: number; tokPerSec?: number; tested?: boolean;
  }[] = [
    {
      id: "general", name: "General Assistant", shorthand: "g", role: "general",
      ...fastest, isDefault: true,
    },
    {
      id: "coding", name: "Coding Assistant", shorthand: "c", role: "coding",
      ...fastest, isDefault: false,
    },
    {
      id: "docs", name: "Documentation", shorthand: "d", role: "docs",
      ...fastest, isDefault: false,
    },
    {
      id: "research", name: "Research / Analysis", shorthand: "r", role: "research",
      ...slowest, isDefault: false,
    },
  ];

  // Only add thinking/worker if we have multiple distinct endpoints
  if (results.length > 1) {
    assignments.push({
      id: "thinking", name: `Deep Thinking (${slowest.model})`, shorthand: "t", role: "thinking",
      ...slowest, isDefault: false,
    });
  }
  if (results.length > 2) {
    assignments.push({
      id: "worker", name: `Worker (${middle.model})`, shorthand: "w", role: "coding",
      ...middle, isDefault: false,
    });
  }

  // Display proposed assignments
  console.log(`${c.dim}Based on benchmark results, here's the proposed agent configuration:${c.reset}\n`);

  for (const a of assignments) {
    const def = a.isDefault ? ` ${c.yellow}(default)${c.reset}` : "";
    const speed = a.durationMs ? ` ${c.dim}(${formatDuration(a.durationMs)})${c.reset}` : "";
    console.log(
      `  ${c.cyan}${a.shorthand}${c.reset} ${c.bold}${a.name}${c.reset}${def}`
    );
    console.log(
      `    ${c.dim}${a.provider}://${a.endpoint} | model: ${a.model}${c.reset}${speed}`
    );
  }

  console.log();
  const acceptAll = await confirm("Accept this configuration?", true);

  if (acceptAll) {
    // Apply all assignments
    setConfig("default_model", fastest.model);
    for (const a of assignments) {
      upsertAgent({
        id: a.id, name: a.name, shorthand: a.shorthand,
        provider: a.provider, endpoint: a.endpoint, model: a.model,
        systemPrompt: getSystemPrompt(a.role),
        isDefault: a.isDefault,
      });
    }
  } else {
    // Let user customize each agent
    console.log(`\n${c.bold}Customize each agent:${c.reset}\n`);
    console.log(`${c.dim}For each agent, pick a model or press Enter to accept the suggestion.${c.reset}\n`);

    // Build numbered model list
    const allModels = buildModelList(online);

    setConfig("default_model", fastest.model);

    for (const a of assignments) {
      const chosen = await pickModelForAgent(a.name, a.model, a.endpointName, allModels);
      upsertAgent({
        id: a.id, name: a.name, shorthand: a.shorthand,
        provider: chosen.provider, endpoint: chosen.endpoint, model: chosen.model,
        systemPrompt: getSystemPrompt(a.role),
        isDefault: a.isDefault,
      });
    }
  }

  // Settings
  await configureSettings();

  console.log(`\n${hr()}`);
  console.log(successMsg("Configuration complete."));
  showFinalConfig();
}

async function configureSettings(): Promise<void> {
  const cfg = getConfig();
  console.log(`\n${c.bold}Settings:${c.reset}\n`);

  const memEnabled = await confirm("Enable directory-based memory?", cfg.memoryEnabled);
  setConfig("memory_enabled", memEnabled ? "true" : "false");

  const nerd = await confirm("Use Iosevka Nerd Font glyphs?", cfg.nerdFonts);
  setConfig("nerd_fonts", nerd ? "true" : "false");

  const stream = await confirm("Enable streaming responses?", cfg.stream);
  setConfig("stream", stream ? "true" : "false");
}

async function customizeAgents(): Promise<void> {
  const gl = g();
  console.log(`\n${c.bold}${gl.robot} Customize Agent Models${c.reset}\n`);
  console.log(`${c.dim}Pick a model for each agent. Press Enter to keep current.${c.reset}\n`);

  // Discover what's available
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  const online = discovered.filter((d) => d.available);

  if (online.length === 0) {
    console.log(errorMsg("No endpoints available."));
    return;
  }

  const allModels = buildModelList(online);
  const agents = listAgents();

  for (const agent of agents) {
    const chosen = await pickModelForAgent(
      `${agent.name} [${agent.shorthand}]`,
      agent.model,
      agent.endpoint,
      allModels
    );
    upsertAgent({
      ...agent,
      provider: chosen.provider,
      endpoint: chosen.endpoint,
      model: chosen.model,
    });
  }

  console.log(`\n${successMsg("Agents updated.")}`);
  showFinalConfig();
}

async function resetAgents(): Promise<void> {
  console.log(`\n${c.dim}Discovering endpoints for reset...${c.reset}`);
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  const online = discovered.filter((d) => d.available);

  if (online.length === 0) {
    console.log(errorMsg("No endpoints available."));
    return;
  }

  // Use first available model on first endpoint
  const ep = online[0];
  const model = ep.models[0] || "unknown";

  seedDefaultAgents(ep.url, model, ep.type);
  setConfig("default_model", model);

  console.log(successMsg(`\nReset all agents to ${model} on ${ep.name}.`));
  console.log(`${c.dim}Run 'shellm config' again and choose "Re-run setup" for benchmarked assignment.${c.reset}`);
  showFinalConfig();
}

interface ModelChoice {
  model: string;
  endpoint: string;
  provider: "ollama" | "openai";
}

function buildModelList(online: DiscoveredEndpoint[]): (ModelChoice & { label: string })[] {
  const list: (ModelChoice & { label: string })[] = [];
  for (const ep of online) {
    for (const model of ep.models) {
      list.push({
        model,
        endpoint: ep.url,
        provider: ep.type,
        label: `${model} on ${ep.name} (${ep.url})`,
      });
    }
  }
  return list;
}

async function pickModelForAgent(
  agentLabel: string,
  currentModel: string,
  currentEndpoint: string,
  allModels: (ModelChoice & { label: string })[]
): Promise<ModelChoice> {
  console.log(`\n${c.cyan}${g().arrow}${c.reset} ${c.bold}${agentLabel}${c.reset}`);
  console.log(`  ${c.dim}current: ${currentModel} (${currentEndpoint})${c.reset}`);
  console.log();

  for (let i = 0; i < allModels.length; i++) {
    const m = allModels[i];
    const current = m.model === currentModel && m.endpoint === currentEndpoint;
    const marker = current ? ` ${c.yellow}<-- current${c.reset}` : "";
    console.log(`  ${c.bold}${i + 1}${c.reset}. ${m.label}${marker}`);
  }

  const answer = await ask(`  Select model`, "");
  if (!answer) {
    // Keep current
    const existing = allModels.find(m => m.model === currentModel && m.endpoint === currentEndpoint);
    return existing || allModels[0];
  }

  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < allModels.length) {
    return allModels[idx];
  }
  return allModels[0];
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
      console.log(`    ${c.cyan}[${a.shorthand}]${c.reset} ${a.name}${def} ${c.dim}(${a.model} on ${a.endpoint})${c.reset}`);
    }
  }
}

function showFinalConfig(): void {
  const gl = g();
  const agents = listAgents();
  console.log(`\n${c.bold}${gl.robot} Active agents:${c.reset}\n`);
  for (const a of agents) {
    const def = a.isDefault ? ` ${c.yellow}(default)${c.reset}` : "";
    console.log(
      `  ${c.cyan}${a.shorthand}${c.reset} ${c.bold}${a.name}${c.reset}${def}`
    );
    console.log(
      `    ${c.dim}${a.provider}://${a.endpoint} | model: ${a.model}${c.reset}`
    );
  }
  console.log(`\n${c.dim}Data stored in: ${getConfig().dataDir}${c.reset}\n`);
}
