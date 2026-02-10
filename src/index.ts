#!/usr/bin/env bun

import { loadEnvFile, getConfig, isConfigured } from "./config";
import { setNerdFonts, c, g, banner, dimText, errorMsg, agentBadge } from "./format";
import { singleQuery, interactiveChat, type QueryOptions } from "./chat";
import { runConfigWizard } from "./tui/config";
import { discoverAll, printDiscovery } from "./llm/discovery";
import { enumerateEndpoints } from "./config";
import { listAgents, getAgent, applyEnvAgentOverrides } from "./agents";
import { listSessions, exportSessionMarkdown } from "./sessions";
import { closeDb } from "./db";
import { runBenchmark } from "./benchmark";
import { generateBashCompletion, generateZshCompletion, generateFishCompletion } from "./completion";

// Load env before anything else
loadEnvFile();

const VERSION = "0.1.0";

// Prompt prefixes: flags that wrap the user's query with specific instructions
const PROMPT_PREFIXES: Record<string, { flag: string; alias: string; description: string; instruction: string }> = {
  clean: {
    flag: "--clean",
    alias: "-C",
    description: "Clean up grammar, spelling, and clarity",
    instruction: "Clean up the grammar, punctuation, spelling, and clarity of the following text. Preserve the original meaning and intent. Output only the corrected text:",
  },
  cmd: {
    flag: "--cmd",
    alias: "-X",
    description: "Return only a shell command, no explanation",
    instruction: "Provide only the shell command to accomplish the following task. No explanation, no markdown code blocks, just the raw command ready to copy-paste:",
  },
  explain: {
    flag: "--explain",
    alias: "-E",
    description: "Explain in clear, simple terms",
    instruction: "Explain the following in clear, simple terms:",
  },
  summarize: {
    flag: "--summarize",
    alias: "-S",
    description: "Summarize concisely",
    instruction: "Summarize the following concisely, capturing only the key points:",
  },
  code: {
    flag: "--code",
    alias: "-K",
    description: "Write code only, minimal comments",
    instruction: "Write clean, working code for the following. Provide only the code with minimal comments:",
  },
};

interface ParsedArgs {
  command: string;
  query?: string;
  agent?: string;
  session?: string;
  prefix?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  execMode: boolean;
  files: string[];
  verbose: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "",
    execMode: false,
    files: [],
    verbose: false,
    help: false,
    version: false,
  };

  // Build a lookup from flags/aliases to prefix keys
  const prefixByFlag = new Map<string, string>();
  for (const [key, p] of Object.entries(PROMPT_PREFIXES)) {
    prefixByFlag.set(p.flag, key);
    prefixByFlag.set(p.alias, key);
  }

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
    } else if (arg === "-m" || arg === "--model") {
      i++;
      result.model = args[i];
    } else if (arg === "-p" || arg === "--system-prompt") {
      i++;
      result.systemPrompt = args[i];
    } else if (arg === "--temp" || arg === "--temperature") {
      i++;
      result.temperature = parseFloat(args[i]);
    } else if (arg === "--top-p") {
      i++;
      result.topP = parseFloat(args[i]);
    } else if (arg === "--max-tokens") {
      i++;
      result.maxTokens = parseInt(args[i]);
    } else if (arg === "--exec" || arg === "--run") {
      result.execMode = true;
    } else if (arg === "-f" || arg === "--file") {
      i++;
      if (args[i]) result.files.push(args[i]);
    } else if (prefixByFlag.has(arg)) {
      result.prefix = prefixByFlag.get(arg)!;
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

/**
 * Read piped stdin (non-TTY). Returns empty string if stdin is a TTY.
 */
async function readPipedInput(): Promise<string> {
  if (process.stdin.isTTY) return "";
  // Use Bun's native stdin reader
  const text = await Bun.stdin.text();
  return text.trim();
}

/**
 * Apply a prompt prefix to a query, combining piped input if present.
 */
function buildQuery(query: string, pipedInput: string, prefixKey?: string): string {
  const prefix = prefixKey ? PROMPT_PREFIXES[prefixKey]?.instruction : undefined;

  // Combine piped input with query argument
  let fullInput: string;
  if (pipedInput && query) {
    // Both: query is the instruction context, piped input is the content
    fullInput = `${query}\n\n${pipedInput}`;
  } else if (pipedInput) {
    fullInput = pipedInput;
  } else {
    fullInput = query;
  }

  // Apply prefix
  if (prefix) {
    return `${prefix}\n\n${fullInput}`;
  }

  return fullInput;
}

function printHelp(): void {
  console.log(`\n${banner()}\n`);
  console.log(`${c.bold}USAGE:${c.reset}`);
  console.log(`  shellm [command] [options]`);
  console.log(`  llm -q "question"               Quick question to default agent`);
  console.log(`  llm -a coding -q "question"     Question to specific agent`);
  console.log(`  llm "question"                  Shorthand for -q`);
  console.log(`  llm chat                        Interactive chat mode`);
  console.log(`  echo "text" | llm               Pipe input as the query`);
  console.log(`  cat file | llm --clean           Pipe + prefix mode`);
  console.log(`  cat file | llm "explain this"   Pipe content with instruction`);
  console.log();
  console.log(`${c.bold}COMMANDS:${c.reset}`);
  console.log(`  chat              Interactive multi-turn chat`);
  console.log(`  config            Configure endpoints, agents, settings`);
  console.log(`  discover          Scan and discover LLM endpoints`);
  console.log(`  agents            List configured agents`);
  console.log(`  models            List available models on all endpoints`);
  console.log(`  sessions          List past conversation sessions`);
  console.log(`  export <id>       Export session to markdown`);
  console.log(`  completion [sh]   Generate shell tab completions (bash/zsh/fish)`);
  console.log(`  benchmark         Test all models, set fastest as default`);
  console.log();
  console.log(`${c.bold}OPTIONS:${c.reset}`);
  console.log(`  -q, --query <text>       Ask a question (single-turn)`);
  console.log(`  -a, --agent <id>         Select agent by id or shorthand`);
  console.log(`  -m, --model <name>       Override model for this query`);
  console.log(`  -p, --system-prompt <t>  Override system prompt`);
  console.log(`  -f, --file <path>        Inject file as context (repeatable)`);
  console.log(`  -s, --session <id>       Continue a session`);
  console.log(`  --temp <0.0-2.0>         Set temperature`);
  console.log(`  --top-p <0.0-1.0>        Set top-p (nucleus sampling)`);
  console.log(`  --max-tokens <n>         Max response tokens`);
  console.log(`  --exec, --run            Execute the LLM's command suggestion`);
  console.log(`  -v, --verbose            Show timing, tokens, endpoint info`);
  console.log(`  -h, --help               Show this help`);
  console.log(`  --version                Show version`);
  console.log();
  console.log(`${c.bold}PROMPT PREFIXES:${c.reset}`);
  for (const [, p] of Object.entries(PROMPT_PREFIXES)) {
    const flags = `${p.alias}, ${p.flag}`;
    console.log(`  ${c.cyan}${flags.padEnd(18)}${c.reset} ${p.description}`);
  }
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
  console.log(`  llm -m qwen2.5:3b "quick question"            Model override`);
  console.log(`  llm --cmd "docker container cpu and memory"    Shell command`);
  console.log(`  llm --cmd --exec "find large files over 1GB"   Suggest + execute`);
  console.log();
  console.log(`  ${c.dim}# Clean up a messy text message or prompt:${c.reset}`);
  console.log(`  llm --clean "i need u to pls fix the auth bug its broke again thx"`);
  console.log(`  ${c.dim}#=> "Please fix the authentication bug -- it's broken again. Thanks."${c.reset}`);
  console.log();
  console.log(`  echo "teh quik brwn fox" | llm --clean         Fix grammar`);
  console.log(`  cat README.md | llm --summarize                Summarize file`);
  console.log(`  cat error.log | llm "what went wrong?"         Pipe + question`);
  console.log(`  git diff | llm "write a commit message"        Pipe diff`);
  console.log(`  llm -f src/main.ts "what does this do?"        File context`);
  console.log(`  llm -f a.ts -f b.ts "compare these"            Multiple files`);
  console.log(`  llm --temp 0 "deterministic answer"            Low temperature`);
  console.log(`  llm export abc123 > session.md                 Export session`);
  console.log(`  llm chat -a research                           Interactive chat`);
  console.log();
  console.log(`${c.bold}TAB COMPLETION:${c.reset}`);
  console.log(`  eval "$(llm completion bash)"    ${c.dim}# add to ~/.bashrc${c.reset}`);
  console.log(`  eval "$(llm completion zsh)"     ${c.dim}# add to ~/.zshrc${c.reset}`);
  console.log(`  llm completion fish > ~/.config/fish/completions/llm.fish`);
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
    console.log(`    ${c.dim}shorthand:${c.reset} ${c.cyan}${a.shorthand}${c.reset}`);
    console.log(`    ${c.dim}model:${c.reset}     ${c.bold}${a.model}${c.reset}`);
    console.log(`    ${c.dim}endpoint:${c.reset}  ${a.endpoint} ${c.dim}(${a.provider})${c.reset}`);
    console.log();
  }
  console.log(`${c.dim}Edit .env SHELLM_AGENT_* vars or run 'shellm config' to change.${c.reset}\n`);
}

async function cmdModels(): Promise<void> {
  const endpoints = enumerateEndpoints();
  const results = await discoverAll(endpoints);
  const gl = g();
  console.log(`\n${c.bold}${gl.server}  Available Models${c.reset}\n`);

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

function cmdCompletion(shell?: string): void {
  switch (shell) {
    case "bash":
      process.stdout.write(generateBashCompletion());
      break;
    case "zsh":
      process.stdout.write(generateZshCompletion());
      break;
    case "fish":
      process.stdout.write(generateFishCompletion());
      break;
    default:
      // Auto-detect shell
      const parentShell = process.env.SHELL || "";
      if (parentShell.includes("zsh")) {
        process.stdout.write(generateZshCompletion());
      } else if (parentShell.includes("fish")) {
        process.stdout.write(generateFishCompletion());
      } else {
        process.stdout.write(generateBashCompletion());
      }
      break;
  }
}

function cmdExport(sessionId?: string): void {
  if (!sessionId) {
    console.error(errorMsg("Usage: llm export <session_id>"));
    console.error(dimText("Run 'llm sessions' to see available session IDs."));
    return;
  }

  const md = exportSessionMarkdown(sessionId);
  if (!md) {
    console.error(errorMsg(`Session "${sessionId}" not found or has no messages.`));
    return;
  }

  // Output to stdout (can be redirected to file)
  process.stdout.write(md);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // Apply config
  const cfg = getConfig();
  setNerdFonts(cfg.nerdFonts);

  // Apply agent overrides from SHELLM_AGENT_* env vars
  if (isConfigured()) {
    applyEnvAgentOverrides();
  }

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

  // Read piped stdin if available (non-TTY)
  const pipedInput = await readPipedInput();

  // Route commands (only when no piped input, or when command is explicit)
  const explicitCommands = ["config", "chat", "discover", "agents", "models", "sessions", "export", "benchmark", "completion"];
  if (!pipedInput || explicitCommands.includes(parsed.command)) {
    switch (parsed.command) {
      case "config":
        await runConfigWizard(!isConfigured());
        closeDb();
        return;

      case "chat":
        await interactiveChat(parsed.agent, parsed.session);
        closeDb();
        return;

      case "discover":
        await cmdDiscover();
        closeDb();
        return;

      case "agents":
        cmdAgents();
        closeDb();
        return;

      case "models":
        await cmdModels();
        closeDb();
        return;

      case "sessions":
        cmdSessions();
        closeDb();
        return;

      case "export":
        cmdExport(parsed.query);
        closeDb();
        return;

      case "completion":
        cmdCompletion(parsed.query);
        closeDb();
        return;

      case "benchmark":
        await runBenchmark();
        closeDb();
        return;
    }
  }

  // Query mode: combine piped input, CLI query, and prefix
  const rawQuery = parsed.query || (parsed.command && !parsed.command.startsWith("-") ? parsed.command : "");
  const finalQuery = buildQuery(rawQuery, pipedInput, parsed.prefix);

  if (finalQuery) {
    // If --cmd prefix is used with --exec, auto-enable exec mode
    const execMode = parsed.execMode || (parsed.prefix === "cmd" && parsed.execMode);

    const opts: QueryOptions = {
      agent: parsed.agent,
      verbose: parsed.verbose,
      modelOverride: parsed.model,
      systemPromptOverride: parsed.systemPrompt,
      temperature: parsed.temperature,
      topP: parsed.topP,
      maxTokens: parsed.maxTokens,
      execMode,
      files: parsed.files.length > 0 ? parsed.files : undefined,
    };
    await singleQuery(finalQuery, opts);
  } else {
    printHelp();
  }

  closeDb();
}

main().catch((err) => {
  console.error(errorMsg(err.message));
  closeDb();
  process.exit(1);
});
