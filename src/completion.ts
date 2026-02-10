/**
 * Shell tab completion scripts for bash and zsh.
 * Usage:
 *   eval "$(llm completion bash)"
 *   eval "$(llm completion zsh)"
 */

import { listAgents } from "./agents";

function getAgentNames(): string[] {
  try {
    const agents = listAgents();
    const names: string[] = [];
    for (const a of agents) {
      names.push(a.id);
      if (a.shorthand && a.shorthand !== a.id) names.push(a.shorthand);
    }
    return names;
  } catch {
    return ["general", "coding", "research", "thinking", "docs", "g", "c", "r", "t", "d"];
  }
}

export function generateBashCompletion(): string {
  const agents = getAgentNames().join(" ");

  return `# shellm/llm bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(llm completion bash)"

_llm_completion() {
    local cur prev
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    local commands="chat config discover agents models sessions export benchmark completion"
    local long_opts="--query --agent --model --system-prompt --file --session --temp --temperature --top-p --max-tokens --exec --run --verbose --help --version --clean --cmd --explain --summarize --code"
    local short_opts="-q -a -m -p -f -s -v -h -C -X -E -S -K"

    case "\${prev}" in
        -a|--agent)
            COMPREPLY=( \$(compgen -W "${agents}" -- "\${cur}") )
            return 0
            ;;
        -m|--model)
            # Dynamic model list from Ollama
            local models
            models=\$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null)
            COMPREPLY=( \$(compgen -W "\${models}" -- "\${cur}") )
            return 0
            ;;
        -f|--file)
            COMPREPLY=( \$(compgen -f -- "\${cur}") )
            return 0
            ;;
        -s|--session)
            return 0
            ;;
        -p|--system-prompt)
            return 0
            ;;
        --temp|--temperature)
            COMPREPLY=( \$(compgen -W "0 0.1 0.3 0.5 0.7 1.0 1.5 2.0" -- "\${cur}") )
            return 0
            ;;
        --top-p)
            COMPREPLY=( \$(compgen -W "0.1 0.5 0.9 0.95 1.0" -- "\${cur}") )
            return 0
            ;;
        --max-tokens)
            COMPREPLY=( \$(compgen -W "256 512 1024 2048 4096 8192" -- "\${cur}") )
            return 0
            ;;
        export)
            return 0
            ;;
        completion)
            COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") )
            return 0
            ;;
    esac

    if [[ "\${cur}" == --* ]]; then
        COMPREPLY=( \$(compgen -W "\${long_opts}" -- "\${cur}") )
        return 0
    fi

    if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( \$(compgen -W "\${short_opts} \${long_opts}" -- "\${cur}") )
        return 0
    fi

    # If first word after 'llm', suggest commands
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
        return 0
    fi

    # Default: file completion
    COMPREPLY=( \$(compgen -f -- "\${cur}") )
    return 0
}
complete -o default -F _llm_completion llm
complete -o default -F _llm_completion shellm
`;
}

export function generateZshCompletion(): string {
  const agents = getAgentNames().map((a) => `'${a}'`).join(" ");

  return `#compdef llm shellm
# shellm/llm zsh completion
# Add to ~/.zshrc:
#   eval "$(llm completion zsh)"

_llm() {
    local -a commands
    commands=(
        'chat:Interactive multi-turn chat'
        'config:Configure endpoints and agents'
        'discover:Scan LLM endpoints'
        'agents:List configured agents'
        'models:List available models'
        'sessions:List past sessions'
        'export:Export session to markdown'
        'benchmark:Test all models'
        'completion:Generate shell completions'
    )

    local -a agents
    agents=(${agents})

    # Dynamic model list
    local -a models
    if (( $+commands[curl] )); then
        models=(\${(f)"$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null)"})
    fi

    _arguments -s \\
        '(-q --query)'{-q,--query}'[Ask a question]:query:' \\
        '(-a --agent)'{-a,--agent}'[Select agent]:agent:(\${agents})' \\
        '(-m --model)'{-m,--model}'[Override model]:model:(\${models})' \\
        '(-p --system-prompt)'{-p,--system-prompt}'[System prompt]:prompt:' \\
        '*'{-f,--file}'[File context]:file:_files' \\
        '(-s --session)'{-s,--session}'[Continue session]:session:' \\
        '--temp[Temperature (0.0-2.0)]:temp:(0 0.1 0.3 0.5 0.7 1.0 1.5 2.0)' \\
        '--top-p[Top-p sampling (0.0-1.0)]:top_p:(0.1 0.5 0.9 0.95 1.0)' \\
        '--max-tokens[Max response tokens]:tokens:(256 512 1024 2048 4096 8192)' \\
        '(--exec --run)--exec[Execute command suggestion]' \\
        '(--exec --run)--run[Execute command suggestion]' \\
        '(-C --clean)'{-C,--clean}'[Clean up grammar and spelling]' \\
        '(-X --cmd)'{-X,--cmd}'[Return shell command only]' \\
        '(-E --explain)'{-E,--explain}'[Explain in simple terms]' \\
        '(-S --summarize)'{-S,--summarize}'[Summarize concisely]' \\
        '(-K --code)'{-K,--code}'[Write code only]' \\
        '(-v --verbose)'{-v,--verbose}'[Show timing and token info]' \\
        '(-h --help)'{-h,--help}'[Show help]' \\
        '--version[Show version]' \\
        '*::command:->command' && return 0

    case "\$state" in
        command)
            _describe -t commands 'llm command' commands
            ;;
    esac
}

compdef _llm llm
compdef _llm shellm
`;
}

export function generateFishCompletion(): string {
  const agents = getAgentNames();

  const lines = [
    "# shellm/llm fish completion",
    "# Add to ~/.config/fish/completions/llm.fish",
    "",
    "# Commands",
    'complete -c llm -n "__fish_use_subcommand" -a "chat" -d "Interactive chat"',
    'complete -c llm -n "__fish_use_subcommand" -a "config" -d "Configure settings"',
    'complete -c llm -n "__fish_use_subcommand" -a "discover" -d "Scan endpoints"',
    'complete -c llm -n "__fish_use_subcommand" -a "agents" -d "List agents"',
    'complete -c llm -n "__fish_use_subcommand" -a "models" -d "List models"',
    'complete -c llm -n "__fish_use_subcommand" -a "sessions" -d "List sessions"',
    'complete -c llm -n "__fish_use_subcommand" -a "export" -d "Export session"',
    'complete -c llm -n "__fish_use_subcommand" -a "benchmark" -d "Benchmark models"',
    'complete -c llm -n "__fish_use_subcommand" -a "completion" -d "Shell completions"',
    "",
    "# Options",
    'complete -c llm -s q -l query -d "Ask a question" -r',
    `complete -c llm -s a -l agent -d "Select agent" -ra "${agents.join(" ")}"`,
    'complete -c llm -s m -l model -d "Override model" -r',
    'complete -c llm -s p -l system-prompt -d "System prompt" -r',
    'complete -c llm -s f -l file -d "File context" -rF',
    'complete -c llm -s s -l session -d "Continue session" -r',
    'complete -c llm -l temp -d "Temperature" -ra "0 0.1 0.3 0.5 0.7 1.0 1.5 2.0"',
    'complete -c llm -l top-p -d "Top-p sampling" -ra "0.1 0.5 0.9 0.95 1.0"',
    'complete -c llm -l max-tokens -d "Max tokens" -ra "256 512 1024 2048 4096 8192"',
    'complete -c llm -l exec -d "Execute command"',
    'complete -c llm -l run -d "Execute command"',
    'complete -c llm -s C -l clean -d "Clean up text"',
    'complete -c llm -s X -l cmd -d "Shell command only"',
    'complete -c llm -s E -l explain -d "Explain"',
    'complete -c llm -s S -l summarize -d "Summarize"',
    'complete -c llm -s K -l code -d "Code only"',
    'complete -c llm -s v -l verbose -d "Verbose output"',
    'complete -c llm -s h -l help -d "Show help"',
    'complete -c llm -l version -d "Show version"',
    "",
    "# Subcommand completions",
    'complete -c llm -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"',
  ];

  return lines.join("\n") + "\n";
}
