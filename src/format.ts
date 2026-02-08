// Terminal formatting with ANSI colors and Nerd Font glyphs

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  bgGray: "\x1b[100m",
};

// Iosevka Nerd Font glyphs
export const glyph = {
  brain: "\uf0e7",
  robot: "\uf544",
  code: "\uf121",
  search: "\uf002",
  doc: "\uf15b",
  chat: "\uf075",
  terminal: "\uf120",
  gear: "\uf013",
  check: "\uf00c",
  cross: "\uf00d",
  arrow: "\uf061",
  arrowRight: "\ue0b0",
  ellipsis: "\uf141",
  server: "\uf233",
  database: "\uf1c0",
  clock: "\uf017",
  folder: "\uf07b",
  star: "\uf005",
  bolt: "\uf0e7",
  eye: "\uf06e",
  pencil: "\uf303",
  send: "\uf1d8",
  memory: "\uf538",
  link: "\uf0c1",
  plug: "\uf1e6",
  spinner: ["\u280b", "\u2819", "\u2838", "\u2834", "\u2826", "\u2807"],
};

const glyphPlain: typeof glyph = {
  brain: "*",
  robot: "[AI]",
  code: "</>",
  search: "?",
  doc: "[D]",
  chat: ">",
  terminal: "$",
  gear: "[S]",
  check: "[ok]",
  cross: "[x]",
  arrow: "->",
  arrowRight: ">",
  ellipsis: "...",
  server: "[S]",
  database: "[DB]",
  clock: "[T]",
  folder: "[/]",
  star: "*",
  bolt: "!",
  eye: "(o)",
  pencil: "[E]",
  send: ">>",
  memory: "[M]",
  link: "~",
  plug: "[P]",
  spinner: ["|", "/", "-", "\\", "|", "/"],
};

let _useNerd = true;
export function setNerdFonts(v: boolean) {
  _useNerd = v;
}
export function g(): typeof glyph {
  return _useNerd ? glyph : glyphPlain;
}

export function banner(): string {
  const gl = g();
  return `${c.bold}${c.cyan}${gl.robot} shellm${c.reset}${c.gray} - quick LLM for the terminal${c.reset}`;
}

export function agentBadge(name: string): string {
  const gl = g();
  const icons: Record<string, string> = {
    general: gl.chat,
    coding: gl.code,
    research: gl.search,
    thinking: gl.brain,
    docs: gl.doc,
  };
  const icon = icons[name] || gl.robot;
  const colors: Record<string, string> = {
    general: c.cyan,
    coding: c.green,
    research: c.yellow,
    thinking: c.magenta,
    docs: c.blue,
  };
  const color = colors[name] || c.white;
  return `${color}${icon} ${name}${c.reset}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function hr(char = "\u2500", width?: number): string {
  const w = width || process.stdout.columns || 80;
  return `${c.gray}${char.repeat(w)}${c.reset}`;
}

export function userPrompt(): string {
  const gl = g();
  return `${c.bold}${c.green}${gl.send} you${c.reset}${c.gray} ${gl.arrowRight}${c.reset} `;
}

export function assistantHeader(agent: string): string {
  const gl = g();
  return `\n${c.bold}${c.cyan}${gl.robot} ${agent}${c.reset}`;
}

export function errorMsg(msg: string): string {
  const gl = g();
  return `${c.red}${gl.cross} ${msg}${c.reset}`;
}

export function successMsg(msg: string): string {
  const gl = g();
  return `${c.green}${gl.check} ${msg}${c.reset}`;
}

export function infoMsg(msg: string): string {
  const gl = g();
  return `${c.blue}${gl.arrow} ${msg}${c.reset}`;
}

export function dimText(msg: string): string {
  return `${c.dim}${msg}${c.reset}`;
}

export class Spinner {
  private frames: string[];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private message: string;

  constructor(message: string) {
    this.frames = g().spinner as string[];
    this.message = message;
  }

  start(): void {
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIdx % this.frames.length];
      process.stderr.write(
        `\r${c.cyan}${frame}${c.reset} ${c.dim}${this.message}${c.reset}\x1b[K`
      );
      this.frameIdx++;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stderr.write("\r\x1b[K");
  }
}
