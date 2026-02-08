# TODO

## v0.2.0

- [ ] Pipe support: `cat file.py | llm "explain this code"`
- [ ] System prompt override via `-p` flag
- [ ] Export session to markdown (`llm export <session_id>`)
- [ ] Model selection per-query (`-m qwen2.5:3b`)
- [ ] Temperature and top-p flags
- [ ] Token budget / max-tokens flag

## v0.3.0

- [ ] Shell command execution mode: LLM suggests command, user confirms, runs it
- [ ] Image input via `imgcat` or file path (multimodal models)
- [ ] File context injection: `llm -f src/main.ts "what does this do?"`
- [ ] RAG mode: index local files for retrieval-augmented queries
- [ ] Agent chaining: pipe output of one agent into another

## Improvements

- [ ] Semantic memory with local embeddings (replace keyword matching)
- [ ] Configurable system prompts per agent via TUI
- [ ] Auto-reconnect on endpoint failure (failover to next available)
- [ ] Streaming token count from Ollama (parse response metadata)
- [ ] Conversation branching in chat mode
- [ ] Response caching for repeated queries
- [ ] Plugin system for custom agents
- [ ] Tab completion for agent names and commands

## Platform

- [ ] Homebrew formula
- [ ] AUR package
- [ ] GitHub Actions CI for automated release builds
- [ ] Docker image for server-side deployment
