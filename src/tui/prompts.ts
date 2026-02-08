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
