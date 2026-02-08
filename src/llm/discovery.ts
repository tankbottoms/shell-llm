import type { Endpoint } from "../config";
import { c, g, Spinner } from "../format";

export interface DiscoveredEndpoint extends Endpoint {
  available: boolean;
  models: string[];
  latencyMs: number;
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
      return { ...ep, available: false, models: [], latencyMs: Date.now() - start };
    }
    const data = (await res.json()) as any;
    const models = (data.models || []).map((m: any) => m.name || m.model);
    return {
      ...ep,
      available: true,
      models,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ...ep, available: false, models: [], latencyMs: Date.now() - start };
  }
}

async function probeOpenAI(ep: Endpoint): Promise<DiscoveredEndpoint> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ep.url}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ...ep, available: false, models: [], latencyMs: Date.now() - start };
    }
    const data = (await res.json()) as any;
    const models = (data.data || []).map((m: any) => m.id);
    return {
      ...ep,
      available: true,
      models,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ...ep, available: false, models: [], latencyMs: Date.now() - start };
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

export function printDiscovery(results: DiscoveredEndpoint[]): void {
  const gl = g();
  console.log(`\n${c.bold}${gl.plug} Endpoint Discovery${c.reset}\n`);

  for (const ep of results) {
    const status = ep.available
      ? `${c.green}${gl.check} online${c.reset}`
      : `${c.red}${gl.cross} offline${c.reset}`;
    const latency = ep.available ? `${c.gray}(${ep.latencyMs}ms)${c.reset}` : "";

    console.log(`  ${status} ${c.bold}${ep.name}${c.reset} ${latency}`);
    console.log(`    ${c.gray}type: ${ep.type} | url: ${ep.url}${c.reset}`);

    if (ep.models.length > 0) {
      console.log(`    ${c.gray}models:${c.reset}`);
      for (const m of ep.models) {
        console.log(`      ${c.cyan}${gl.arrow} ${m}${c.reset}`);
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
