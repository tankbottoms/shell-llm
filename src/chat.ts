import { createInterface } from "readline";
import { getDefaultAgent, getAgent } from "./agents";
import { chatCompletion, type ChatMessage, type ChatResponse } from "./llm/client";
import {
  createSession,
  addMessage,
  getSessionMessages,
  updateSessionTitle,
} from "./sessions";
import { storeMemory, getRelevantMemory, formatMemoryContext } from "./memory";
import { getConfig } from "./config";
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
  Spinner,
  agentBadge,
} from "./format";

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

export async function singleQuery(
  question: string,
  agentId?: string,
  verbose = false
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

  // Build messages
  const messages: ChatMessage[] = [
    { role: "system", content: agent.systemPrompt },
  ];

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
    console.error(
      dimText(`${g().plug} ${agent.provider}://${agent.endpoint} | ${agent.model}`)
    );
  }

  // Stream response
  let response: ChatResponse;

  if (cfg.stream) {
    process.stdout.write(`${assistantHeader(agent.id)}\n`);
    const waitSpinner = new Spinner("thinking...");
    let firstVisible = true;
    const thinkFilter = createThinkFilter();
    waitSpinner.start();
    response = await chatCompletion(
      agent.provider,
      agent.endpoint,
      agent.model,
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
          // Estimate tokens if API didn't report them
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
      }
    );
  } else {
    const spinner = new Spinner("thinking...");
    spinner.start();
    response = await chatCompletion(
      agent.provider,
      agent.endpoint,
      agent.model,
      messages,
      false
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

  // Stats line
  if (verbose) {
    console.error(
      dimText(
        `\n${g().clock} ${formatDuration(response.durationMs)} | ` +
          `in: ${formatTokens(response.tokensIn)} | ` +
          `out: ${formatTokens(response.tokensOut)} | ` +
          `session: ${sessionId}`
      )
    );
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
