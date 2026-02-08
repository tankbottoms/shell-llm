# shellm

Quick LLM chat for the terminal. Single binary, zero dependencies. Connects to local [Ollama](https://ollama.com) and [OpenAI-compatible](https://platform.openai.com/docs/api-reference) (vLLM, TGI, LiteLLM) endpoints.

```
$ llm "What is the fastest way to count lines in a file?"

 general
wc -l filename

The `wc -l` command counts the number of lines in a file efficiently.
It is optimized for this task and typically faster than alternatives
like `awk` or `grep`.
```

## Features

- **Single-turn queries** from the command line (`llm "question"`)
- **Interactive multi-turn chat** with session history (`llm chat`)
- **Multiple agents** with shorthand keys (general, coding, research, thinking, docs, worker)
- **Auto-discovery** of Ollama and OpenAI-compatible endpoints on your network
- **Benchmark mode** to test all endpoints and auto-select the fastest model
- **Think-block filtering** strips `<think>` reasoning from models like Qwen3 and DeepSeek-R1
- **Directory-scoped memory** remembers past Q&A for context in future queries
- **Session tracking** with resume support
- **Streaming** with braille spinner animation while waiting for responses
- **Cross-platform** single-file binaries for macOS ARM64, Linux ARM64, Linux x64
- **Nerd Font glyphs** (Iosevka) with graceful fallback

## Install

### From source (requires [Bun](https://bun.sh) 1.3+)

```bash
git clone https://github.com/tankbottoms/shell-llm.git
cd shell-llm
bun install
bun run build:all
bash scripts/install.sh
```

This builds for your platform, copies the binary to `~/.local/bin/shellm`, and adds `alias llm='shellm'` to your shell profile.

### Pre-built binaries

Download from [Releases](https://github.com/tankbottoms/shell-llm/releases) and place in your `$PATH`:

```bash
chmod +x shellm-*
mv shellm-macos-arm64 ~/.local/bin/shellm
echo 'alias llm="shellm"' >> ~/.zshrc
```

## Quick start

```bash
# First run launches the config wizard
shellm

# Or point at your Ollama instance directly
cp .env.example ~/.local/store/shellm/.env
# Edit to match your endpoints, then:
shellm discover
shellm benchmark
```

## Usage

```
USAGE:
  shellm [command] [options]
  llm -q "question"               Quick question to default agent
  llm -a coding -q "question"     Question to specific agent
  llm "question"                  Shorthand for -q
  llm chat                        Interactive chat mode
  llm chat -a research            Chat with specific agent

COMMANDS:
  chat              Interactive multi-turn chat
  config            Configure endpoints, agents, settings
  discover          Scan and discover LLM endpoints
  agents            List configured agents
  models            List available models on all endpoints
  sessions          List past conversation sessions
  benchmark         Test all models, set fastest as default

OPTIONS:
  -q, --query <text>     Ask a question (single-turn)
  -a, --agent <id>       Select agent by id or shorthand
  -s, --session <id>     Continue a session
  -v, --verbose          Show timing, tokens, endpoint info
  -h, --help             Show this help
  --version              Show version
```

## Agents

Each agent has a system prompt tuned for its purpose and a single-letter shorthand:

| Shorthand | ID | Purpose |
|-----------|----------|------------------------------|
| `g` | general | General assistant (default) |
| `c` | coding | Code generation, debugging |
| `d` | docs | Documentation writer |
| `r` | research | Deep analysis, reasoning |
| `t` | thinking | Extended chain-of-thought |
| `w` | worker | Fast task execution |

```bash
llm -a c -q "write a python quicksort"
llm -a r -q "explain TCP vs UDP" -v
llm -a t -q "what are the tradeoffs of B-trees vs LSM-trees?"
```

### Listing agents

```
$ llm agents

 Configured Agents

   general (default)
    shorthand: g | model: Qwen3-32B-AWQ
    openai://http://spark-2.local:8007

   coding
    shorthand: c | model: Qwen3-32B-AWQ
    openai://http://spark-2.local:8007

   thinking
    shorthand: t | model: llama3.1:8b
    ollama://http://localhost:11434

   worker
    shorthand: w | model: Qwen3-32B-AWQ
    openai://http://spark-1.local:8006
```

## Endpoint discovery

shellm auto-discovers models on all configured endpoints:

```
$ llm discover

 Endpoint Discovery

   online ollama-00 (localhost:11434) (21ms)
    type: ollama | url: http://localhost:11434
    models: llama3.1:8b, qwen2.5:3b, gpt-oss:20b

   online ollama-01 (spark-1.local:11434) (425ms)
    type: ollama | url: http://spark-1.local:11434
    models: glm-4.7-flash, mistral-small3.1, deepseek-r1, ...

   online openai-00 (spark-1.local:8006) (410ms)
    type: openai | url: http://spark-1.local:8006
    models: Qwen3-32B-AWQ

   online openai-01 (spark-2.local:8007) (25ms)
    type: openai | url: http://spark-2.local:8007
    models: Qwen3-32B-AWQ

4/4 endpoints available
```

## Benchmark

Tests one model per endpoint and auto-configures the fastest as default:

```bash
$ llm benchmark

 Model Benchmark

  Testing one model per endpoint: "What is the capital of France?"

   qwen2.5:3b on ollama-00
    3.2s | 28.1 tok/s | 89 tokens
   glm-4.7-flash:latest on ollama-01
    8.1s | 12.4 tok/s | 101 tokens
   Qwen3-32B-AWQ on openai-00
    9.6s | 10.8 tok/s | 104 tokens
   Qwen3-32B-AWQ on openai-01
    8.6s | 10.8 tok/s | 93 tokens

 Rankings (fastest response):

  1st qwen2.5:3b (ollama-00) - 3.2s (28.1 tok/s)
  2nd Qwen3-32B-AWQ (openai-01) - 8.6s (10.8 tok/s)
  3th glm-4.7-flash:latest (ollama-01) - 8.1s
  4th Qwen3-32B-AWQ (openai-00) - 9.6s (10.8 tok/s)

 Default set to Qwen3-32B-AWQ on openai-01
```

## Sessions

All conversations are tracked and can be resumed:

```
$ llm sessions

 Recent Sessions

  mle8z42tpp29b3  thinking 2 msgs
    what is 2+2
     ~/Developer/shell-llm | 2026-02-08 21:23:57

  mle8y8koyicdje  general 2 msgs
    How to swap two variables without using a temporary variable in c?
     ~ | 2026-02-08 21:21:11

Resume with: llm chat -s <session_id>
```

## Interactive chat

```bash
llm chat                    # Chat with default agent
llm chat -a research        # Chat with research agent
llm chat -s mle8z42tpp29b3  # Resume a previous session
```

Chat commands: `/quit`, `/clear`, `/info`, `/help`

## Configuration

### Endpoints (.env)

shellm reads from `~/.local/store/shellm/.env` (or `$SHELLM_DATA_DIR/.env`):

```bash
# Ollama endpoints (auto-discovers all models on each)
OLLAMA_HOST_00=localhost
OLLAMA_PORT_00=11434
OLLAMA_HOST_01=my-server
OLLAMA_PORT_01=11434

# OpenAI-compatible API endpoints (vLLM, TGI, LiteLLM, etc.)
OPENAI_COMPATIBLE_API_HOST_00=gpu-server-1
OPENAI_COMPATIBLE_API_PORT_00=8000

# Settings
SHELLM_NERD_FONTS=true
SHELLM_STREAM=true
SHELLM_MEMORY_ENABLED=true
SHELLM_MEMORY_MAX_CONTEXT=5
```

Add as many `_XX` endpoint pairs as needed. shellm enumerates them automatically.

### Data storage

Everything lives in `~/.local/store/shellm/`:

```
~/.local/store/shellm/
  .env            # Endpoint configuration
  shellm.db       # SQLite: agents, sessions, memory, config
```

## Architecture

```
src/
  index.ts        # CLI entry point, arg parsing, command routing
  chat.ts         # Single-turn queries and interactive chat
  benchmark.ts    # Model benchmarking with OOM detection
  config.ts       # .env loading, enumerated endpoint discovery
  db.ts           # SQLite database (bun:sqlite)
  agents.ts       # Agent CRUD, system prompts, defaults
  sessions.ts     # Session management
  memory.ts       # Directory-scoped keyword memory
  format.ts       # ANSI colors, Nerd Font glyphs, spinner
  llm/
    client.ts     # Unified Ollama + OpenAI chat completion client
    discovery.ts  # Endpoint probing and model enumeration
  tui/
    config.ts     # Interactive config wizard
    prompts.ts    # Terminal prompt helpers
```

## Building

```bash
bun run build:macos       # macOS ARM64
bun run build:linux-arm   # Linux ARM64 (DGX Spark, Raspberry Pi)
bun run build:linux-x64   # Linux x64
bun run build:all         # All platforms
```

Outputs single-file compiled binaries in `dist/`.

## Requirements

- [Bun](https://bun.sh) 1.3+ (build-time only; the compiled binary has no runtime dependencies)
- At least one Ollama or OpenAI-compatible endpoint

## License

MIT
