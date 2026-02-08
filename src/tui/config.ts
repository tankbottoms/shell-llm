import { c, g, banner, successMsg, infoMsg, hr, errorMsg, Spinner, formatDuration } from "../format";
import {
  getConfig,
  setConfig,
  enumerateEndpoints,
  writeEnvAgents,
} from "../config";
import { discoverAll, printDiscovery, type DiscoveredEndpoint } from "../llm/discovery";
import { seedDefaultAgents, listAgents, upsertAgent, getSystemPrompt } from "../agents";
import { benchmarkModel, pickTestModel, isOomError, TEST_PROMPT } from "../benchmark";
import { ask, confirm, select, arrowSelect, type ArrowOption } from "./prompts";

interface ModelOption {
  model: string;
  endpoint: string;
  endpointName: string;
  provider: "ollama" | "openai";
  durationMs?: number;
  tokPerSec?: number;
  tested: boolean;
}

// ── Main Config Wizard ──────────────────────────────────────────

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

  // ── Step 3: Assign models to agents ───────────────────────
  console.log(`\n${c.bold}Step 3/3: Assigning models to agents${c.reset}\n`);

  const fastest = results[0];
  const slowest = results.length > 1 ? results[results.length - 1] : fastest;
  const middle = results.length > 2 ? results[1] : fastest;

  // Build proposed auto-assignments
  const assignments: {
    id: string; name: string; shorthand: string; role: string;
    model: string; endpoint: string; endpointName: string;
    provider: "ollama" | "openai"; isDefault: boolean;
    durationMs?: number; tokPerSec?: number;
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
      `  ${agentIcon(a.id)} ${c.bold}${a.name}${c.reset}${def}`
    );
    console.log(
      `    ${c.cyan}${a.model}${c.reset} ${c.dim}on ${a.endpointName}${c.reset}${speed}`
    );
  }

  console.log();
  const acceptAll = await confirm("Accept this configuration?", true);

  if (acceptAll) {
    applyAssignments(assignments);
  } else {
    // Let user customize each agent with arrow-key selection
    console.log(`\n${c.bold}Customize each agent:${c.reset}`);
    console.log(`${c.dim}Use arrow keys to select a model for each agent.${c.reset}`);
    console.log(`${c.dim}Fastest models are highlighted at the top.${c.reset}\n`);

    const modelOptions = buildArrowOptions(results);

    for (const a of assignments) {
      // Pre-select the auto-assigned model
      const defaultIdx = modelOptions.findIndex(
        (o) => o.value === `${a.model}||${a.endpoint}||${a.provider}`
      );

      console.log(`${hr("─", 50)}`);
      console.log(`\n  ${agentIcon(a.id)} ${c.bold}${a.name}${c.reset}${a.isDefault ? ` ${c.yellow}(default)${c.reset}` : ""}`);

      const { value } = await arrowSelect(
        `Model for ${a.name}:`,
        modelOptions,
        Math.max(0, defaultIdx),
      );

      const parsed = parseModelValue(value);
      a.model = parsed.model;
      a.endpoint = parsed.endpoint;
      a.provider = parsed.provider;
      a.endpointName = modelOptions.find((o) => o.value === value)?.dimLabel?.replace(/^on /, "").replace(/ \(.*/, "") || a.endpointName;
    }

    applyAssignments(assignments);
  }

  // Settings
  await configureSettings();

  console.log(`\n${hr()}`);
  console.log(successMsg("Configuration complete."));
  showFinalConfig();
}

// ── Customize Agents (arrow-key selection) ──────────────────

async function customizeAgents(): Promise<void> {
  const gl = g();
  console.log(`\n${c.bold}${gl.robot} Customize Agent Models${c.reset}\n`);
  console.log(`${c.dim}Use arrow keys to pick a model for each agent.${c.reset}`);
  console.log(`${c.dim}Fastest responding models are highlighted at the top.${c.reset}\n`);

  // Discover what's available
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  const online = discovered.filter((d) => d.available);

  if (online.length === 0) {
    console.log(errorMsg("No endpoints available."));
    return;
  }

  // Quick latency test to sort models
  const modelInfos = collectModels(online);
  const tested = await measureLatency(modelInfos);
  const modelOptions = buildArrowOptions(tested);

  const agents = listAgents();
  const updatedAgents: { id: string; model: string; endpoint: string; provider: string }[] = [];

  for (const agent of agents) {
    const currentVal = `${agent.model}||${agent.endpoint}||${agent.provider}`;
    const defaultIdx = modelOptions.findIndex((o) => o.value === currentVal);

    console.log(`${hr("─", 50)}`);
    console.log(`\n  ${agentIcon(agent.id)} ${c.bold}${agent.name}${c.reset} ${c.dim}[${agent.shorthand}]${c.reset}`);
    console.log(`  ${c.dim}current: ${agent.model} on ${agent.endpoint}${c.reset}`);

    const { value } = await arrowSelect(
      `Model for ${agent.name}:`,
      modelOptions,
      Math.max(0, defaultIdx),
    );

    const parsed = parseModelValue(value);
    upsertAgent({
      ...agent,
      provider: parsed.provider,
      endpoint: parsed.endpoint,
      model: parsed.model,
    });

    updatedAgents.push({ id: agent.id, ...parsed });
  }

  // Persist to .env
  writeEnvAgents(updatedAgents);

  console.log(`\n${successMsg("Agents updated.")}`);
  showFinalConfig();
}

// ── Settings ────────────────────────────────────────────────

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

// ── Reset Agents ────────────────────────────────────────────

async function resetAgents(): Promise<void> {
  console.log(`\n${c.dim}Discovering endpoints for reset...${c.reset}`);
  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  const online = discovered.filter((d) => d.available);

  if (online.length === 0) {
    console.log(errorMsg("No endpoints available."));
    return;
  }

  const ep = online[0];
  const model = ep.models[0] || "unknown";

  seedDefaultAgents(ep.url, model, ep.type);
  setConfig("default_model", model);

  // Persist defaults to .env
  const agents = listAgents();
  writeEnvAgents(agents.map((a) => ({
    id: a.id, model: a.model, endpoint: a.endpoint, provider: a.provider,
  })));

  console.log(successMsg(`\nReset all agents to ${model} on ${ep.name}.`));
  console.log(`${c.dim}Run 'shellm config' again and choose "Re-run setup" for benchmarked assignment.${c.reset}`);
  showFinalConfig();
}

// ── Helpers ─────────────────────────────────────────────────

function applyAssignments(assignments: {
  id: string; name: string; shorthand: string; role: string;
  model: string; endpoint: string; provider: "ollama" | "openai";
  isDefault: boolean;
}[]): void {
  const generalCfg = assignments.find((a) => a.id === "general") || assignments[0];
  setConfig("default_model", generalCfg.model);

  for (const a of assignments) {
    upsertAgent({
      id: a.id, name: a.name, shorthand: a.shorthand,
      provider: a.provider, endpoint: a.endpoint, model: a.model,
      systemPrompt: getSystemPrompt(a.role),
      isDefault: a.isDefault,
    });
  }

  // Persist to .env
  writeEnvAgents(
    assignments.map((a) => ({
      id: a.id, model: a.model, endpoint: a.endpoint, provider: a.provider,
    }))
  );
}

function collectModels(online: DiscoveredEndpoint[]): ModelOption[] {
  const models: ModelOption[] = [];
  for (const ep of online) {
    for (const model of ep.models) {
      models.push({
        model,
        endpoint: ep.url,
        endpointName: ep.name,
        provider: ep.type,
        tested: false,
      });
    }
  }
  return models;
}

async function measureLatency(models: ModelOption[]): Promise<ModelOption[]> {
  const gl = g();
  console.log(`\n${c.bold}${gl.bolt} Measuring response latency...${c.reset}\n`);

  for (const m of models) {
    const label = `${m.model} ${c.dim}on ${m.endpointName}${c.reset}`;
    process.stderr.write(`  ${c.dim}${gl.clock} testing ${label}...${c.reset}\x1b[K`);

    try {
      const bench = await benchmarkModel(m.provider, m.endpoint, m.model);
      if (bench.success) {
        m.durationMs = bench.durationMs;
        m.tokPerSec = bench.tokensOut > 0 && bench.durationMs > 0
          ? (bench.tokensOut / bench.durationMs) * 1000 : 0;
        m.tested = true;
        process.stderr.write(
          `\r  ${c.green}${gl.check}${c.reset} ${label} ${c.cyan}${formatDuration(bench.durationMs)}${c.reset}\x1b[K\n`
        );
      } else {
        process.stderr.write(
          `\r  ${c.red}${gl.cross}${c.reset} ${label} ${c.dim}${bench.error || "no response"}${c.reset}\x1b[K\n`
        );
      }
    } catch {
      process.stderr.write(
        `\r  ${c.red}${gl.cross}${c.reset} ${label} ${c.dim}failed${c.reset}\x1b[K\n`
      );
    }
  }

  // Sort: tested models by latency (fastest first), untested at end
  models.sort((a, b) => {
    if (!a.tested && !b.tested) return 0;
    if (!a.tested) return 1;
    if (!b.tested) return -1;
    return (a.durationMs || Infinity) - (b.durationMs || Infinity);
  });

  return models;
}

/**
 * Build arrow-select options from model list.
 * Fastest model gets a bolt badge.
 */
function buildArrowOptions(models: ModelOption[]): ArrowOption[] {
  const options: ArrowOption[] = [];
  let fastestFound = false;

  for (const m of models) {
    const latencyStr = m.durationMs !== undefined
      ? formatDuration(m.durationMs)
      : "not tested";
    const speedStr = m.tokPerSec && m.tokPerSec > 0
      ? ` ${m.tokPerSec.toFixed(1)} tok/s`
      : "";

    let badge = "";
    if (m.tested && !fastestFound) {
      badge = `${g().bolt} fastest`;
      fastestFound = true;
    }

    options.push({
      label: m.model,
      value: `${m.model}||${m.endpoint}||${m.provider}`,
      dimLabel: `on ${m.endpointName} (${latencyStr}${speedStr})`,
      badge,
    });
  }

  return options;
}

function parseModelValue(val: string): { model: string; endpoint: string; provider: "ollama" | "openai" } {
  const [model, endpoint, provider] = val.split("||");
  return { model, endpoint, provider: provider as "ollama" | "openai" };
}

function agentIcon(id: string): string {
  const gl = g();
  const icons: Record<string, string> = {
    general: `${c.cyan}${gl.chat}${c.reset}`,
    coding: `${c.green}${gl.code}${c.reset}`,
    research: `${c.yellow}${gl.search}${c.reset}`,
    thinking: `${c.magenta}${gl.brain}${c.reset}`,
    docs: `${c.blue}${gl.doc}${c.reset}`,
    worker: `${c.white}${gl.terminal}${c.reset}`,
  };
  return icons[id] || `${c.white}${gl.robot}${c.reset}`;
}

// ── Display ─────────────────────────────────────────────────

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
      console.log(
        `    ${c.cyan}[${a.shorthand}]${c.reset} ${a.name}${def} ${c.dim}${a.model} on ${a.endpoint}${c.reset}`
      );
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
      `  ${agentIcon(a.id)} ${c.bold}${a.name}${c.reset}${def}`
    );
    console.log(
      `    ${c.cyan}${a.model}${c.reset} ${c.dim}on ${a.endpoint} (${a.provider})${c.reset}`
    );
  }
  console.log(`\n${c.dim}Agent-model mapping saved to .env and database.${c.reset}`);
  console.log(`${c.dim}Edit .env SHELLM_AGENT_* vars or run 'shellm config' to change.${c.reset}`);
  console.log(`${c.dim}Data stored in: ${getConfig().dataDir}${c.reset}\n`);
}
