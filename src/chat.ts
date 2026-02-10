import { createInterface } from "readline";
import { readFileSync, existsSync, createReadStream, openSync } from "fs";
import { resolve } from "path";
import { getDefaultAgent, getAgent } from "./agents";
import { chatCompletion, type ChatMessage, type ChatResponse, type ChatOptions } from "./llm/client";
import {
  createSession,
  addMessage,
  getSessionMessages,
  updateSessionTitle,
} from "./sessions";
import { storeMemory, getRelevantMemory, formatMemoryContext } from "./memory";
import { getConfig, enumerateEndpoints } from "./config";
import {
  c,
  g,
  hr,
  userPrompt,
  assistantHeader,
  formatDuration,
  formatTokens,
  dimText,
  errorMsg,
  successMsg,
  Spinner,
  agentBadge,
} from "./format";

export interface QueryOptions {
  agent?: string;
  verbose?: boolean;
  modelOverride?: string;
  systemPromptOverride?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  execMode?: boolean;
  files?: string[];
}

// Filter <think>...</think> blocks from streaming output
function createThinkFilter() {
  let inThink = false;
  let buffer = "";
  let thinkContent = "";

  return {
    filter(token: string): string {
      buffer += token;
      let output = "";

      while (buffer.length > 0) {
        if (inThink) {
          const endIdx = buffer.indexOf("</think>");
          if (endIdx !== -1) {
            thinkContent += buffer.slice(0, endIdx);
            buffer = buffer.slice(endIdx + 8);
            inThink = false;
            // Skip any leading newlines after think block
            buffer = buffer.replace(/^\n+/, "");
          } else {
            thinkContent += buffer;
            buffer = "";
          }
        } else {
          const startIdx = buffer.indexOf("<think>");
          if (startIdx !== -1) {
            output += buffer.slice(0, startIdx);
            buffer = buffer.slice(startIdx + 7);
            inThink = true;
          } else if (buffer.includes("<thin") || buffer.includes("<thi") || buffer.includes("<th") || buffer.includes("<t")) {
            // Might be start of <think> tag, hold in buffer
            if (buffer.length > 7) {
              output += buffer.slice(0, buffer.length - 7);
              buffer = buffer.slice(buffer.length - 7);
            }
            break;
          } else {
            output += buffer;
            buffer = "";
          }
        }
      }

      return output;
    },
    getThinkContent(): string {
      return thinkContent;
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Read file contents for context injection.
 */
function readFileContext(filePaths: string[]): string {
  const parts: string[] = [];
  for (const fp of filePaths) {
    const resolved = resolve(process.cwd(), fp);
    if (!existsSync(resolved)) {
      console.error(errorMsg(`File not found: ${fp}`));
      continue;
    }
    const content = readFileSync(resolved, "utf-8");
    parts.push(`--- File: ${fp} ---\n${content}\n--- End: ${fp} ---`);
  }
  return parts.join("\n\n");
}

/**
 * Attempt a chat completion with failover to other endpoints on connection error.
 */
async function chatWithFailover(
  provider: "ollama" | "openai",
  endpoint: string,
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  callbacks?: Parameters<typeof chatCompletion>[5],
  chatOpts?: ChatOptions,
  verbose = false
): Promise<ChatResponse> {
  try {
    return await chatCompletion(provider, endpoint, model, messages, stream, callbacks, chatOpts);
  } catch (err: any) {
    // Only failover on connection errors, not API errors
    const isConnectionError = err.message?.includes("fetch") ||
      err.message?.includes("ECONNREFUSED") ||
      err.message?.includes("ETIMEDOUT") ||
      err.message?.includes("NetworkError") ||
      err.code === "ECONNREFUSED";

    if (!isConnectionError) throw err;

    if (verbose) {
      console.error(dimText(`${g().cross} ${endpoint} failed, trying failover...`));
    }

    // Find alternative endpoints of the same provider type
    const allEndpoints = enumerateEndpoints();
    const alternatives = allEndpoints.filter(
      (ep) => ep.type === provider && ep.url !== endpoint
    );

    for (const alt of alternatives) {
      try {
        if (verbose) {
          console.error(dimText(`${g().plug} trying ${alt.url}...`));
        }
        return await chatCompletion(provider, alt.url, model, messages, stream, callbacks, chatOpts);
      } catch {
        continue;
      }
    }

    // If same-type failover failed, try any available endpoint
    const otherType = allEndpoints.filter(
      (ep) => ep.type !== provider && ep.url !== endpoint
    );
    for (const alt of otherType) {
      try {
        if (verbose) {
          console.error(dimText(`${g().plug} trying ${alt.type}://${alt.url}...`));
        }
        return await chatCompletion(alt.type, alt.url, model, messages, stream, callbacks, chatOpts);
      } catch {
        continue;
      }
    }

    // All failed
    throw new Error(`All endpoints failed. Original error: ${err.message}`);
  }
}

/**
 * Prompt user to confirm and execute a shell command.
 * Falls back to /dev/tty for confirmation if stdin was piped.
 */
async function promptAndExecute(command: string): Promise<void> {
  // Strip markdown code fences if present
  let cmd = command.trim();
  if (cmd.startsWith("```")) {
    cmd = cmd.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
  }

  const gl = g();
  console.log(`\n${c.bold}${gl.terminal} Command:${c.reset}`);
  console.log(`  ${c.cyan}${cmd}${c.reset}\n`);

  // If stdin was piped, open /dev/tty for interactive confirmation
  let input: NodeJS.ReadableStream;
  if (process.stdin.isTTY) {
    input = process.stdin;
  } else {
    try {
      const fd = openSync("/dev/tty", "r");
      input = createReadStream("", { fd }) as any;
    } catch {
      // No TTY available (e.g., in a non-interactive environment)
      console.error(dimText("no TTY available for confirmation, skipping execution"));
      return;
    }
  }

  const rl = createInterface({ input, output: process.stderr });

  return new Promise<void>((res) => {
    rl.question(`${c.yellow}Execute? [y/N]${c.reset} `, (answer) => {
      rl.close();
      if (answer.trim().toLowerCase() === "y") {
        console.log(dimText(`${gl.arrow} running...\n`));
        const proc = Bun.spawnSync(["bash", "-c", cmd], {
          stdout: "inherit",
          stderr: "inherit",
          cwd: process.cwd(),
        });
        if (proc.exitCode !== 0) {
          console.error(errorMsg(`exit code ${proc.exitCode}`));
        } else {
          console.log(successMsg("done"));
        }
      } else {
        console.log(dimText("skipped"));
      }
      res();
    });
  });
}

export async function singleQuery(
  question: string,
  opts: QueryOptions = {}
): Promise<void> {
  const agent = opts.agent
    ? getAgent(opts.agent)
    : getDefaultAgent();

  if (!agent) {
    console.error(errorMsg(`Agent "${opts.agent || "default"}" not found. Run: shellm config`));
    process.exit(1);
  }

  const cfg = getConfig();
  const dir = process.cwd();
  const verbose = opts.verbose || false;

  // Resolve model (CLI override > agent default)
  const model = opts.modelOverride || agent.model;

  // Resolve system prompt (CLI override > agent default)
  const systemPrompt = opts.systemPromptOverride || agent.systemPrompt;

  // Resolve API key from endpoint config
  const endpoints = enumerateEndpoints();
  const matchedEndpoint = endpoints.find((ep) => ep.url === agent.endpoint);
  const apiKey = matchedEndpoint?.apiKey;

  // Build chat options with sensible defaults
  const chatOpts: ChatOptions = {
    temperature: opts.temperature ?? 0.7,
    topP: opts.topP ?? 0.9,
    maxTokens: opts.maxTokens ?? 4096,
  };
  if (apiKey) chatOpts.apiKey = apiKey;

  // Build messages
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Inject file context if provided
  if (opts.files && opts.files.length > 0) {
    const fileCtx = readFileContext(opts.files);
    if (fileCtx) {
      messages.push({ role: "system", content: `File context:\n\n${fileCtx}` });
      if (verbose) {
        console.error(dimText(`${g().doc} ${opts.files.length} file(s) loaded as context`));
      }
    }
  }

  // Add memory context if enabled
  if (cfg.memoryEnabled) {
    const memories = getRelevantMemory(dir, question, cfg.memoryMaxContext);
    if (memories.length > 0) {
      const ctx = formatMemoryContext(memories);
      messages.push({ role: "system", content: ctx });
      if (verbose) {
        console.error(
          dimText(`${g().memory} ${memories.length} relevant memories loaded`)
        );
      }
    }
  }

  messages.push({ role: "user", content: question });

  // Create session for tracking
  const sessionId = createSession(agent.id, dir, question.slice(0, 80));
  addMessage(sessionId, "user", question, dir);

  if (verbose) {
    const modelInfo = model !== agent.model ? ` (override: ${model})` : "";
    console.error(
      dimText(`${g().plug} ${agent.provider}://${agent.endpoint} | ${model}${modelInfo}`)
    );
    if (Object.keys(chatOpts).length > 0) {
      const parts: string[] = [];
      if (chatOpts.temperature !== undefined) parts.push(`temp=${chatOpts.temperature}`);
      if (chatOpts.topP !== undefined) parts.push(`top_p=${chatOpts.topP}`);
      if (chatOpts.maxTokens !== undefined) parts.push(`max_tokens=${chatOpts.maxTokens}`);
      console.error(dimText(`${g().gear} ${parts.join(" | ")}`));
    }
  }

  // Stream response with failover
  let response: ChatResponse;

  if (cfg.stream) {
    process.stdout.write(`${assistantHeader(agent.id)}\n`);
    const waitSpinner = new Spinner("thinking...");
    let firstVisible = true;
    const thinkFilter = createThinkFilter();
    waitSpinner.start();
    response = await chatWithFailover(
      agent.provider,
      agent.endpoint,
      model,
      messages,
      true,
      {
        onToken: (token) => {
          const filtered = thinkFilter.filter(token);
          if (filtered) {
            if (firstVisible) {
              waitSpinner.stop();
              firstVisible = false;
            }
            process.stdout.write(filtered);
          }
        },
        onDone: (resp) => {
          if (firstVisible) waitSpinner.stop();
          if (resp.tokensOut === 0 && resp.content.length > 0) {
            resp.tokensOut = estimateTokens(resp.content);
          }
          if (resp.tokensIn === 0) {
            resp.tokensIn = estimateTokens(messages.map((m) => m.content).join(" "));
          }
          process.stdout.write("\n");
        },
        onError: (err) => {
          waitSpinner.stop();
          console.error(errorMsg(err.message));
        },
      },
      chatOpts,
      verbose
    );
  } else {
    const spinner = new Spinner("thinking...");
    spinner.start();
    response = await chatWithFailover(
      agent.provider,
      agent.endpoint,
      model,
      messages,
      false,
      undefined,
      chatOpts,
      verbose
    );
    spinner.stop();
    console.log(`${assistantHeader(agent.id)}\n${response.content}`);
  }

  // Store in session and memory
  addMessage(
    sessionId,
    "assistant",
    response.content,
    dir,
    response.tokensIn,
    response.tokensOut,
    response.durationMs
  );
  if (cfg.memoryEnabled) {
    storeMemory(dir, question, response.content);
  }

  // Stats line (always show timing + tokens; verbose adds session ID)
  const statsLine = `${g().clock} ${formatDuration(response.durationMs)} | ` +
    `in: ${formatTokens(response.tokensIn)} | out: ${formatTokens(response.tokensOut)}` +
    (verbose ? ` | session: ${sessionId}` : "");
  console.error(dimText(statsLine));

  // Shell execution mode
  if (opts.execMode) {
    await promptAndExecute(response.content);
  }
}

export async function interactiveChat(
  agentId?: string,
  sessionId?: string
): Promise<void> {
  const agent = agentId
    ? getAgent(agentId)
    : getDefaultAgent();

  if (!agent) {
    console.error(errorMsg(`Agent "${agentId || "default"}" not found. Run: shellm config`));
    process.exit(1);
  }

  const cfg = getConfig();
  const dir = process.cwd();
  const gl = g();

  console.log(`\n${hr()}`);
  console.log(
    `${c.bold}${gl.chat} Interactive Chat${c.reset} with ${agentBadge(agent.id)}`
  );
  console.log(
    dimText(`model: ${agent.model} | endpoint: ${agent.endpoint}`)
  );
  console.log(dimText(`type /help for commands, /quit to exit`));
  console.log(`${hr()}\n`);

  // Load or create session
  let sid = sessionId || createSession(agent.id, dir);
  const messages: ChatMessage[] = [
    { role: "system", content: agent.systemPrompt },
  ];

  // Restore previous messages if resuming
  if (sessionId) {
    const prev = getSessionMessages(sessionId);
    messages.push(...prev);
    console.log(dimText(`Resumed session ${sessionId} with ${prev.length} messages\n`));
  }

  // Add memory context
  if (cfg.memoryEnabled) {
    const memCount = getRelevantMemory(dir, "", 1).length;
    if (memCount > 0) {
      console.log(dimText(`${gl.memory} ${memCount} memories available in this directory\n`));
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: userPrompt(),
  });

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle commands
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.toLowerCase();
      if (cmd === "/quit" || cmd === "/q" || cmd === "/exit") {
        console.log(dimText("\nSession ended."));
        rl.close();
        return;
      }
      if (cmd === "/help" || cmd === "/h") {
        printChatHelp();
        rl.prompt();
        return;
      }
      if (cmd === "/clear") {
        messages.length = 1; // Keep system prompt
        console.log(dimText("Chat history cleared."));
        rl.prompt();
        return;
      }
      if (cmd === "/info") {
        console.log(dimText(`Agent: ${agent.id} (${agent.name})`));
        console.log(dimText(`Model: ${agent.model}`));
        console.log(dimText(`Endpoint: ${agent.endpoint}`));
        console.log(dimText(`Session: ${sid}`));
        console.log(dimText(`Messages: ${messages.length - 1}`));
        rl.prompt();
        return;
      }
      console.log(dimText(`Unknown command: ${trimmed}. Type /help`));
      rl.prompt();
      return;
    }

    // Add memory context for first message
    if (cfg.memoryEnabled && messages.length <= 1) {
      const memories = getRelevantMemory(dir, trimmed, cfg.memoryMaxContext);
      if (memories.length > 0) {
        messages.push({
          role: "system",
          content: formatMemoryContext(memories),
        });
      }
    }

    messages.push({ role: "user", content: trimmed });
    addMessage(sid, "user", trimmed, dir);

    // Update session title from first message
    if (messages.filter((m) => m.role === "user").length === 1) {
      updateSessionTitle(sid, trimmed.slice(0, 80));
    }

    process.stdout.write(`${assistantHeader(agent.id)}\n`);

    try {
      const chatSpinner = new Spinner("thinking...");
      let chatFirstVisible = true;
      const chatThinkFilter = createThinkFilter();
      if (cfg.stream) chatSpinner.start();

      const response = await chatCompletion(
        agent.provider,
        agent.endpoint,
        agent.model,
        messages,
        cfg.stream,
        cfg.stream
          ? {
              onToken: (token) => {
                const filtered = chatThinkFilter.filter(token);
                if (filtered) {
                  if (chatFirstVisible) {
                    chatSpinner.stop();
                    chatFirstVisible = false;
                  }
                  process.stdout.write(filtered);
                }
              },
              onDone: (resp) => {
                if (chatFirstVisible) chatSpinner.stop();
                if (resp.tokensOut === 0 && resp.content.length > 0) {
                  resp.tokensOut = estimateTokens(resp.content);
                }
                if (resp.tokensIn === 0) {
                  resp.tokensIn = estimateTokens(messages.map((m) => m.content).join(" "));
                }
              },
              onError: (err) => {
                chatSpinner.stop();
                console.error(errorMsg(err.message));
              },
            }
          : undefined
      );

      if (!cfg.stream) {
        process.stdout.write(response.content);
      }

      process.stdout.write("\n\n");
      console.log(
        dimText(
          `${gl.clock} ${formatDuration(response.durationMs)} | ` +
            `tokens: ${formatTokens(response.tokensIn)}/${formatTokens(response.tokensOut)}`
        )
      );
      console.log();

      messages.push({ role: "assistant", content: response.content });
      addMessage(
        sid,
        "assistant",
        response.content,
        dir,
        response.tokensIn,
        response.tokensOut,
        response.durationMs
      );

      if (cfg.memoryEnabled) {
        storeMemory(dir, trimmed, response.content);
      }
    } catch (err: any) {
      console.error(errorMsg(err.message));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

function printChatHelp(): void {
  console.log(`\n${c.bold}Chat Commands:${c.reset}\n`);
  console.log(`  ${c.cyan}/quit${c.reset}, ${c.cyan}/q${c.reset}      Exit chat`);
  console.log(`  ${c.cyan}/clear${c.reset}          Clear conversation history`);
  console.log(`  ${c.cyan}/info${c.reset}           Show session info`);
  console.log(`  ${c.cyan}/help${c.reset}, ${c.cyan}/h${c.reset}      Show this help`);
  console.log();
}
