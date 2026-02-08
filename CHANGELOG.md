# Changelog

## [0.1.0] - 2026-02-08

Initial release.

### Added

- Single-turn query mode (`llm "question"`, `llm -q "question"`)
- Interactive multi-turn chat with readline (`llm chat`)
- Agent system with 6 default agents: general, coding, docs, research, thinking, worker
- Agent shorthand keys for quick selection (`-a c`, `-a t`, `-a r`)
- Ollama API support (`/api/chat`, `/api/tags`) with streaming
- OpenAI-compatible API support (`/v1/chat/completions`, `/v1/models`) with SSE streaming
- Enumerated endpoint configuration via `.env` (`OLLAMA_HOST_XX`, `OPENAI_COMPATIBLE_API_HOST_XX`)
- Auto-discovery of all configured endpoints with model enumeration
- Benchmark command: tests one model per endpoint, auto-sets fastest as default
- OOM detection during benchmark (skips models that fail due to memory)
- Think-block filtering: strips `<think>...</think>` from reasoning models (Qwen3, DeepSeek-R1)
- Braille spinner animation while waiting for LLM responses
- Directory-scoped memory system with keyword-based relevance (Jaccard similarity)
- Session tracking with resume support (`llm chat -s <id>`)
- SQLite storage via `bun:sqlite` (agents, sessions, messages, memory, config)
- Nerd Font glyph support (Iosevka) with plain-text fallback
- Verbose mode with timing, token counts, endpoint info (`-v`)
- Token estimation for providers that don't report usage (vLLM streaming)
- Interactive config wizard for first-run setup
- Cross-platform compiled binaries: macOS ARM64, Linux ARM64, Linux x64
- Install script with shell alias setup (`llm` -> `shellm`)
