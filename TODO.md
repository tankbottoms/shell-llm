# TODO

## v0.2.0

- [x] Default switches for common requests for search-command, clean-up, clean-up-concise etc.
- [x] Pipe support: `cat file.py | llm "explain this code"`
- [x] System prompt override via `-p` flag
- [x] Export session to markdown (`llm export <session_id>`)
- [x] Model selection per-query (`-m qwen2.5:3b`)
- [x] Temperature and top-p flags
- [x] Token budget / max-tokens flag

## v0.3.0

- [x] Shell command execution mode: LLM suggests command, user confirms, runs it
- [ ] Image input via `imgcat` or file path (multimodal models)
- [x] File context injection: `llm -f src/main.ts "what does this do?"`
- [ ] RAG mode: index local files for retrieval-augmented queries
- [ ] Agent chaining: pipe output of one agent into another

## Improvements

- [ ] Semantic memory with local embeddings (replace keyword matching)
- [ ] Configurable system prompts per agent via TUI
- [x] Auto-reconnect on endpoint failure (failover to next available)
- [ ] Streaming token count from Ollama (parse response metadata)
- [ ] Conversation branching in chat mode
- [ ] Response caching for repeated queries
- [ ] Plugin system for custom agents
- [x] Tab completion for agent names and commands
- [x] API key auth for cloud endpoints (Gemini, OpenRouter, Mistral, DeepSeek)
- [x] Ollama model metadata (parameter size, context length, multimodal detection)
- [x] Sensible defaults for temperature (0.7), top-p (0.9), max-tokens (4096)
- [x] Always-visible timing and token counts

## Platform

- [ ] Homebrew formula
- [ ] AUR package
- [ ] GitHub Actions CI for automated release builds
- [ ] Docker image for server-side deployment
