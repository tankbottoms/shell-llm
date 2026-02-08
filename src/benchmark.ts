import { enumerateEndpoints } from "./config";
import { discoverAll, type DiscoveredEndpoint } from "./llm/discovery";
import { chatCompletion, type ChatMessage } from "./llm/client";
import { setConfig } from "./config";
import { seedDefaultAgents, upsertAgent, getSystemPrompt } from "./agents";
import { c, g, Spinner, formatDuration } from "./format";

interface BenchmarkResult {
  endpoint: DiscoveredEndpoint;
  model: string;
  provider: "ollama" | "openai";
  durationMs: number;
  tokensOut: number;
  tokPerSec: number;
  success: boolean;
  error?: string;
  skipped?: boolean;
}

const TEST_PROMPT: ChatMessage[] = [
  { role: "system", content: "Answer in one short sentence." },
  { role: "user", content: "What is the capital of France?" },
];

const OOM_PATTERNS = [
  "more system memory",
  "signal: killed",
  "out of memory",
  "OOM",
  "not enough memory",
];

function isOomError(error: string): boolean {
  const lower = error.toLowerCase();
  return OOM_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

// Pick one representative model per endpoint: smallest for Ollama, first for OpenAI
function pickTestModel(ep: DiscoveredEndpoint): string | null {
  if (ep.models.length === 0) return null;
  if (ep.type === "openai") return ep.models[0];
  // For Ollama, models are listed - just pick the first (they're returned in order)
  // Prefer smaller models by filtering out known large ones
  return ep.models[0];
}

async function benchmarkModel(
  provider: "ollama" | "openai",
  endpoint: string,
  model: string
): Promise<{ durationMs: number; tokensOut: number; success: boolean; error?: string }> {
  try {
    const resp = await chatCompletion(provider, endpoint, model, TEST_PROMPT, false);
    return {
      durationMs: resp.durationMs,
      tokensOut: resp.tokensOut,
      success: resp.content.length > 0,
    };
  } catch (err: any) {
    return { durationMs: 0, tokensOut: 0, success: false, error: err.message };
  }
}

export async function runBenchmark(): Promise<void> {
  const gl = g();
  console.log(`\n${c.bold}${gl.bolt} Model Benchmark${c.reset}\n`);
  console.log(`${c.dim}Testing one model per endpoint: "${TEST_PROMPT[1].content}"${c.reset}\n`);

  const endpoints = enumerateEndpoints();
  const discovered = await discoverAll(endpoints);
  const online = discovered.filter((d) => d.available);

  if (online.length === 0) {
    console.log(`${c.red}${gl.cross} No endpoints available.${c.reset}`);
    return;
  }

  const results: BenchmarkResult[] = [];
  const oomModels = new Set<string>();

  for (const ep of online) {
    const model = pickTestModel(ep);
    if (!model) {
      console.log(
        `  ${c.dim}${gl.cross} ${ep.name} - no models available${c.reset}`
      );
      continue;
    }

    // Skip if this model already OOM'd on another endpoint
    if (oomModels.has(model) && ep.type === "ollama") {
      console.log(
        `  ${c.yellow}${gl.arrow}${c.reset} ${c.dim}${model} on ${ep.name} - skipped (OOM on other endpoint)${c.reset}`
      );
      results.push({
        endpoint: ep, model, provider: ep.type,
        durationMs: 0, tokensOut: 0, tokPerSec: 0,
        success: false, skipped: true,
      });
      continue;
    }

    const spinner = new Spinner(`testing ${model} on ${ep.name}...`);
    spinner.start();

    const bench = await benchmarkModel(ep.type, ep.url, model);

    spinner.stop();

    // Track OOM failures
    if (!bench.success && bench.error && isOomError(bench.error)) {
      oomModels.add(model);
      console.log(
        `  ${c.red}${gl.cross}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset}`
      );
      console.log(`    ${c.red}OOM - insufficient memory, skipping this model${c.reset}`);
      results.push({
        endpoint: ep, model, provider: ep.type,
        durationMs: 0, tokensOut: 0, tokPerSec: 0,
        success: false, error: "OOM",
      });
      continue;
    }

    const tokPerSec = bench.tokensOut > 0 && bench.durationMs > 0
      ? (bench.tokensOut / bench.durationMs) * 1000
      : 0;

    results.push({
      endpoint: ep, model, provider: ep.type,
      durationMs: bench.durationMs, tokensOut: bench.tokensOut,
      tokPerSec, success: bench.success, error: bench.error,
    });

    if (bench.success) {
      console.log(
        `  ${c.green}${gl.check}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset}`
      );
      console.log(
        `    ${c.cyan}${formatDuration(bench.durationMs)}${c.reset}` +
          (tokPerSec > 0 ? ` | ${tokPerSec.toFixed(1)} tok/s` : "") +
          ` | ${bench.tokensOut} tokens`
      );
    } else {
      console.log(
        `  ${c.red}${gl.cross}${c.reset} ${c.bold}${model}${c.reset} ${c.dim}on ${ep.name}${c.reset}`
      );
      console.log(`    ${c.red}${bench.error || "no response"}${c.reset}`);
    }
  }

  // Sort by speed (fastest first)
  const successful = results.filter((r) => r.success);
  if (successful.length === 0) {
    console.log(`\n${c.red}${gl.cross} No models responded successfully.${c.reset}`);
    return;
  }

  successful.sort((a, b) => a.durationMs - b.durationMs);

  console.log(`\n${c.bold}${gl.star} Rankings (fastest response):${c.reset}\n`);
  for (let i = 0; i < successful.length; i++) {
    const r = successful[i];
    const medal = i === 0 ? `${c.yellow}1st${c.reset}` : i === 1 ? `${c.white}2nd${c.reset}` : `${c.dim}${i + 1}th${c.reset}`;
    console.log(
      `  ${medal} ${c.bold}${r.model}${c.reset} ${c.dim}(${r.endpoint.name})${c.reset} - ${c.cyan}${formatDuration(r.durationMs)}${c.reset}` +
        (r.tokPerSec > 0 ? ` (${r.tokPerSec.toFixed(1)} tok/s)` : "")
    );
  }

  // Set fastest as default
  const fastest = successful[0];
  setConfig("default_model", fastest.model);
  seedDefaultAgents(fastest.endpoint.url, fastest.model, fastest.provider);

  // Assign thinking agent to the most capable (largest/slowest) successful model
  if (successful.length > 1) {
    const slowest = successful[successful.length - 1];
    upsertAgent({
      id: "thinking",
      name: `Deep Thinking (${slowest.model})`,
      shorthand: "t",
      provider: slowest.provider,
      endpoint: slowest.endpoint.url,
      model: slowest.model,
      systemPrompt: getSystemPrompt("thinking"),
      isDefault: false,
    });
  }

  // If there's a second-fastest, use it as worker
  if (successful.length > 2) {
    const second = successful[1];
    upsertAgent({
      id: "worker",
      name: `Worker (${second.model})`,
      shorthand: "w",
      provider: second.provider,
      endpoint: second.endpoint.url,
      model: second.model,
      systemPrompt: getSystemPrompt("coding"),
      isDefault: false,
    });
  }

  console.log(
    `\n${c.green}${gl.check}${c.reset} Default set to ${c.bold}${fastest.model}${c.reset} on ${fastest.endpoint.name} (${formatDuration(fastest.durationMs)})`
  );
  console.log(`${c.dim}Run 'shellm agents' to see full configuration.${c.reset}\n`);
}
