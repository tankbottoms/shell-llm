import { createInterface } from "readline";
import { c, g } from "../format";

const rl = () =>
  createInterface({ input: process.stdin, output: process.stderr });

export async function ask(prompt: string, defaultVal?: string): Promise<string> {
  const defStr = defaultVal ? `${c.dim} (${defaultVal})${c.reset}` : "";
  return new Promise((resolve) => {
    const r = rl();
    r.question(`${c.cyan}${g().arrow}${c.reset} ${prompt}${defStr}: `, (answer) => {
      r.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await ask(`${prompt} [${hint}]`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

export async function select(
  prompt: string,
  options: { label: string; value: string }[]
): Promise<string> {
  const gl = g();
  console.error(`\n${c.cyan}${gl.arrow}${c.reset} ${prompt}\n`);
  for (let i = 0; i < options.length; i++) {
    console.error(`  ${c.bold}${i + 1}${c.reset}. ${options[i].label}`);
  }
  console.error();
  const answer = await ask("Select option", "1");
  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  return options[0].value;
}

export async function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const r = rl();
    r.question(prompt, (answer) => {
      r.close();
      resolve(answer);
    });
  });
}

export interface ArrowOption {
  label: string;
  value: string;
  badge?: string;    // e.g. "fastest" shown as a tag
  dimLabel?: string;  // secondary text shown after label
}

/**
 * Arrow-key driven selector. Shows a list, user navigates with up/down,
 * confirms with Enter. Fastest/recommended items should be placed first
 * with a badge to draw attention.
 */
export async function arrowSelect(
  prompt: string,
  options: ArrowOption[],
  defaultIdx = 0
): Promise<{ value: string; index: number }> {
  if (options.length === 0) {
    throw new Error("arrowSelect: no options provided");
  }
  if (options.length === 1) {
    return { value: options[0].value, index: 0 };
  }

  return new Promise((resolve) => {
    let idx = defaultIdx;
    const { stdin, stderr } = process;
    const gl = g();

    function renderLine(i: number): string {
      const selected = i === idx;
      const cursor = selected
        ? `${c.cyan}${gl.arrow}${c.reset}`
        : " ";
      const label = selected
        ? `${c.bold}${c.white}${options[i].label}${c.reset}`
        : `${options[i].label}`;
      const dim = options[i].dimLabel
        ? ` ${c.dim}${options[i].dimLabel}${c.reset}`
        : "";
      const badge = options[i].badge
        ? ` ${c.bold}${c.yellow}${options[i].badge}${c.reset}`
        : "";
      return `  ${cursor} ${label}${dim}${badge}`;
    }

    // Print header + all options initially
    stderr.write(`\n${c.cyan}${gl.arrow}${c.reset} ${prompt} ${c.dim}(arrows to move, enter to select)${c.reset}\n\n`);
    for (let i = 0; i < options.length; i++) {
      stderr.write(`${renderLine(i)}\n`);
    }

    function redraw(): void {
      // Move cursor up to the start of the option list
      stderr.write(`\x1b[${options.length}A`);
      for (let i = 0; i < options.length; i++) {
        stderr.write(`\r${renderLine(i)}\x1b[K\n`);
      }
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(data: string | Buffer): void {
      const key = data.toString();

      if (key === "\x1b[A" || key === "k") {
        // Up arrow or k
        idx = Math.max(0, idx - 1);
        redraw();
      } else if (key === "\x1b[B" || key === "j") {
        // Down arrow or j
        idx = Math.min(options.length - 1, idx + 1);
        redraw();
      } else if (key === "\r" || key === "\n") {
        // Enter
        cleanup();
        resolve({ value: options[idx].value, index: idx });
      } else if (key === "\x03") {
        // Ctrl+C
        cleanup();
        process.exit(0);
      }
    }

    function cleanup(): void {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}
