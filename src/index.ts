#!/usr/bin/env bun

import { loadEnvFile, getConfig, isConfigured } from "./config";
import { setNerdFonts, c, g, banner, dimText, errorMsg, agentBadge } from "./format";
import { singleQuery, interactiveChat } from "./chat";
import { runConfigWizard } from "./tui/config";
import { discoverAll, printDiscovery } from "./llm/discovery";
import { enumerateEndpoints } from "./config";
import { listAgents, getAgent } from "./agents";
import { listSessions } from "./sessions";
import { closeDb } from "./db";
import { runBenchmark } from "./benchmark";

// Load env before anything else
loadEnvFile();

const VERSION = "0.1.0";

interface ParsedArgs {
  command: string;
  query?: string;
  agent?: string;
  session?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "",
    verbose: false,
    help: false,
    version: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "--version") {
      result.version = true;
    } else if (arg === "-v" || arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "-q" || arg === "--query") {
      i++;
      result.query = args[i];
    } else if (arg === "-a" || arg === "--agent") {
      i++;
      result.agent = args[i];
    } else if (arg === "-s" || arg === "--session") {
      i++;
      result.session = args[i];
    } else if (!arg.startsWith("-") && !result.command) {
      result.command = arg;
    } else if (!arg.startsWith("-") && result.command && !result.query) {
      // Allow: llm "question" as shorthand
      result.query = arg;
    }
    i++;
  }

  return result;
}

function printHelp(): void {
  const gl = g();
  console.log(`\n${banner()}\n`);
  console.log(`${c.bold}USAGE:${c.reset}`);
  console.log(`  shellm [command] [options]`);
  console.log(`  llm -q "question"               Quick question to default agent`);
  console.log(`  llm -a coding -q "question"     Question to specific agent`);
  console.log(`  llm "question"                  Shorthand for -q`);
  console.log(`  llm chat                        Interactive chat mode`);
  console.log(`  llm chat -a research            Chat with specific agent`);
  console.log();
  console.log(`${c.bold}COMMANDS:${c.reset}`);
  console.log(`  chat              Interactive multi-turn chat`);
  console.log(`  config            Configure endpoints, agents, settings`);
  console.log(`  discover          Scan and discover LLM endpoints`);
  console.log(`  agents            List configured agents`);
  console.log(`  models            List available models on all endpoints`);
  console.log(`  sessions          List past conversation sessions`);
  console.log(`  benchmark         Test all models, set fastest as default`);
  console.log();
  console.log(`${c.bold}OPTIONS:${c.reset}`);
  console.log(`  -q, --query <text>     Ask a question (single-turn)`);
  console.log(`  -a, --agent <id>       Select agent by id or shorthand`);
  console.log(`  -s, --session <id>     Continue a session`);
  console.log(`  -v, --verbose          Show timing, tokens, endpoint info`);
  console.log(`  -h, --help             Show this help`);
  console.log(`  --version              Show version`);
  console.log();
  console.log(`${c.bold}AGENTS:${c.reset}`);
  const agents = listAgents();
  if (agents.length > 0) {
    for (const a of agents) {
      const def = a.isDefault ? ` ${c.yellow}*${c.reset}` : "";
      console.log(`  ${c.cyan}${a.shorthand}${c.reset} / ${c.cyan}${a.id}${c.reset}  ${a.name}${def}`);
    }
  } else {
    console.log(`  ${c.dim}No agents configured. Run: shellm config${c.reset}`);
  }
  console.log();
  console.log(`${c.bold}EXAMPLES:${c.reset}`);
  console.log(`  llm "how do I find files by name recursively?"`);
  console.log(`  llm -a c -q "write a python quicksort"`);
  console.log(`  llm -a r -q "explain TCP vs UDP" -v`);
  console.log(`  llm chat -a research`);
  console.log(`  llm sessions`);
  console.log();
}

async function cmdDiscover(): Promise<void> {
  const endpoints = enumerateEndpoints();
  const results = await discoverAll(endpoints);
  printDiscovery(results);
}

function cmdAgents(): void {
  const agents = listAgents();
  const gl = g();
  if (agents.length === 0) {
    console.log(errorMsg("No agents configured. Run: shellm config"));
    return;
  }
  console.log(`\n${c.bold}${gl.robot} Configured Agents${c.reset}\n`);
  for (const a of agents) {
    const def = a.isDefault ? ` ${c.yellow}(default)${c.reset}` : "";
    console.log(`  ${agentBadge(a.id)}${def}`);
    console.log(`    ${c.dim}shorthand: ${a.shorthand} | model: ${a.model}${c.reset}`);
    console.log(`    ${c.dim}${a.provider}://${a.endpoint}${c.reset}`);
    console.log();
  }
}

async function cmdModels(): Promise<void> {
  const endpoints = enumerateEndpoints();
  const results = await discoverAll(endpoints);
  const gl = g();
  console.log(`\n${c.bold}${gl.server} Available Models${c.reset}\n`);

  for (const ep of results) {
    if (!ep.available) {
      console.log(`  ${c.red}${gl.cross}${c.reset} ${c.dim}${ep.name} (offline)${c.reset}`);
      continue;
    }
    console.log(`  ${c.green}${gl.check}${c.reset} ${c.bold}${ep.name}${c.reset}`);
    for (const m of ep.models) {
      console.log(`    ${c.cyan}${gl.arrow} ${m}${c.reset}`);
    }
  }
  console.log();
}

function cmdSessions(): void {
  const sessions = listSessions(undefined, 20);
  const gl = g();

  if (sessions.length === 0) {
    console.log(dimText("No sessions yet. Ask a question to start one."));
    return;
  }

  console.log(`\n${c.bold}${gl.chat} Recent Sessions${c.reset}\n`);

  for (const s of sessions) {
    const agent = getAgent(s.agentId);
    const agentLabel = agent ? agentBadge(agent.id) : s.agentId;
    const title = s.title || "(untitled)";
    const msgs = s.messageCount || 0;
    const dir = s.directory.replace(process.env.HOME || "", "~");

    console.log(
      `  ${c.bold}${s.id}${c.reset} ${agentLabel} ${c.dim}${msgs} msgs${c.reset}`
    );
    console.log(`    ${c.white}${title}${c.reset}`);
    console.log(`    ${c.dim}${gl.folder} ${dir} | ${s.updatedAt}${c.reset}`);
    console.log();
  }

  console.log(dimText(`Resume with: llm chat -s <session_id>\n`));
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // Apply config
  const cfg = getConfig();
  setNerdFonts(cfg.nerdFonts);

  if (parsed.version) {
    console.log(`shellm v${VERSION}`);
    process.exit(0);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  // First-run check
  if (!isConfigured() && !parsed.command) {
    await runConfigWizard(true);
    closeDb();
    process.exit(0);
  }

  // Route commands
  switch (parsed.command) {
    case "config":
      await runConfigWizard(!isConfigured());
      break;

    case "chat":
      await interactiveChat(parsed.agent, parsed.session);
      break;

    case "discover":
      await cmdDiscover();
      break;

    case "agents":
      cmdAgents();
      break;

    case "models":
      await cmdModels();
      break;

    case "sessions":
      cmdSessions();
      break;

    case "benchmark":
      await runBenchmark();
      break;

    default:
      // Query mode: either -q flag or bare argument
      if (parsed.query) {
        await singleQuery(parsed.query, parsed.agent, parsed.verbose);
      } else if (parsed.command && !parsed.command.startsWith("-")) {
        // Treat the command itself as a query if it doesn't match a known command
        await singleQuery(parsed.command, parsed.agent, parsed.verbose);
      } else {
        printHelp();
      }
      break;
  }

  closeDb();
}

main().catch((err) => {
  console.error(errorMsg(err.message));
  closeDb();
  process.exit(1);
});
