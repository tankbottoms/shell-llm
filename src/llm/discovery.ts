import type { Endpoint } from "../config";
import { c, g, Spinner } from "../format";

export interface ModelInfo {
  name: string;
  parameterSize: string;
  quantization: string;
  contextLength: number;
  families: string[];
  isMultimodal: boolean;
  sizeBytes: number;
}

export interface DiscoveredEndpoint extends Endpoint {
  available: boolean;
  models: string[];
  modelInfo: ModelInfo[];
  latencyMs: number;
}

async function fetchOllamaModelInfo(url: string, modelName: string): Promise<ModelInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const details = data.details || {};
    const info = data.model_info || {};

    // Find context length from model_info (varies by family)
    let contextLength = 0;
    for (const [k, v] of Object.entries(info)) {
      if (k.toLowerCase().includes("context_length") && typeof v === "number") {
        contextLength = v;
        break;
      }
    }

    const families: string[] = details.families || [];
    const isMultimodal = families.some((f: string) =>
      ["clip", "mllama", "vision", "llava"].includes(f.toLowerCase())
    );

    return {
      name: modelName,
      parameterSize: details.parameter_size || "?",
      quantization: details.quantization_level || "?",
      contextLength,
      families,
      isMultimodal,
      sizeBytes: 0,
    };
  } catch {
    return null;
  }
}

async function probeOllama(ep: Endpoint): Promise<DiscoveredEndpoint> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ep.url}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ...ep, available: false, models: [], modelInfo: [], latencyMs: Date.now() - start };
    }
    const data = (await res.json()) as any;
    const rawModels = data.models || [];
    const models = rawModels.map((m: any) => m.name || m.model);

    // Fetch detailed info for each model (in parallel, with timeout)
    const infoPromises = models.map((name: string) => fetchOllamaModelInfo(ep.url, name));
    const infoResults = await Promise.all(infoPromises);
    const modelInfo = infoResults.filter((m): m is ModelInfo => m !== null);

    // Attach size from tags response
    for (const mi of modelInfo) {
      const raw = rawModels.find((r: any) => (r.name || r.model) === mi.name);
      if (raw?.size) mi.sizeBytes = raw.size;
    }

    return {
      ...ep,
      available: true,
      models,
      modelInfo,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ...ep, available: false, models: [], modelInfo: [], latencyMs: Date.now() - start };
  }
}

async function probeOpenAI(ep: Endpoint): Promise<DiscoveredEndpoint> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const headers: Record<string, string> = {};
    if (ep.apiKey) {
      headers["Authorization"] = `Bearer ${ep.apiKey}`;
    }
    const res = await fetch(`${ep.url}/v1/models`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ...ep, available: false, models: [], modelInfo: [], latencyMs: Date.now() - start };
    }
    const data = (await res.json()) as any;
    const models = (data.data || []).map((m: any) => m.id);
    return {
      ...ep,
      available: true,
      models,
      modelInfo: [],
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ...ep, available: false, models: [], modelInfo: [], latencyMs: Date.now() - start };
  }
}

export async function discoverAll(
  endpoints: Endpoint[],
  showProgress = true
): Promise<DiscoveredEndpoint[]> {
  const spinner = showProgress ? new Spinner("discovering endpoints...") : null;
  spinner?.start();

  const results = await Promise.all(
    endpoints.map((ep) =>
      ep.type === "ollama" ? probeOllama(ep) : probeOpenAI(ep)
    )
  );

  spinner?.stop();
  return results;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)}MB`;
  return `${(bytes / 1e9).toFixed(1)}GB`;
}

export function printDiscovery(results: DiscoveredEndpoint[]): void {
  const gl = g();
  console.log(`\n${c.bold}${gl.plug} Endpoint Discovery${c.reset}\n`);

  for (const ep of results) {
    const status = ep.available
      ? `${c.green}${gl.check} online${c.reset}`
      : `${c.red}${gl.cross} offline${c.reset}`;
    const latency = ep.available ? `${c.gray}(${ep.latencyMs}ms)${c.reset}` : "";
    const auth = ep.apiKey ? ` ${c.yellow}[key]${c.reset}` : "";

    console.log(`  ${status} ${c.bold}${ep.name}${c.reset}${auth} ${latency}`);
    console.log(`    ${c.gray}type: ${ep.type} | url: ${ep.url}${c.reset}`);

    if (ep.models.length > 0) {
      console.log(`    ${c.gray}models:${c.reset}`);
      for (const m of ep.models) {
        const info = ep.modelInfo.find((mi) => mi.name === m);
        if (info) {
          const size = formatBytes(info.sizeBytes);
          const ctx = info.contextLength > 0 ? `${(info.contextLength / 1024).toFixed(0)}k ctx` : "";
          const modal = info.isMultimodal ? " [vision]" : "";
          const meta = [info.parameterSize, info.quantization, ctx, size].filter(Boolean).join(" | ");
          console.log(`      ${c.cyan}${gl.arrow} ${m}${c.reset}${c.magenta}${modal}${c.reset}`);
          console.log(`        ${c.dim}${meta}${c.reset}`);
        } else {
          console.log(`      ${c.cyan}${gl.arrow} ${m}${c.reset}`);
        }
      }
    }
    console.log();
  }

  const online = results.filter((r) => r.available).length;
  const total = results.length;
  console.log(
    `${c.dim}${online}/${total} endpoints available${c.reset}\n`
  );
}
