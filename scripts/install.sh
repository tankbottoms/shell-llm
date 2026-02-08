#!/usr/bin/env bash
set -euo pipefail

SHELLM_DIR="$HOME/.local/store/shellm"
BIN_DIR="$HOME/.local/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing shellm..."

# Create directories
mkdir -p "$SHELLM_DIR"
mkdir -p "$BIN_DIR"

# Copy .env.example if no .env exists
if [ ! -f "$SHELLM_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$SHELLM_DIR/.env"
  echo "Created $SHELLM_DIR/.env from template"
fi

# Build for current platform
echo "Building shellm..."
cd "$PROJECT_DIR"

if [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]; then
  bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile "$BIN_DIR/shellm"
elif [[ "$(uname -m)" == "aarch64" ]]; then
  bun build src/index.ts --compile --target=bun-linux-arm64 --outfile "$BIN_DIR/shellm"
else
  bun build src/index.ts --compile --outfile "$BIN_DIR/shellm"
fi

chmod +x "$BIN_DIR/shellm"

# Add alias to shell rc files
add_alias() {
  local rc_file="$1"
  if [ -f "$rc_file" ]; then
    if ! grep -q 'alias llm=' "$rc_file" 2>/dev/null; then
      echo '' >> "$rc_file"
      echo '# shellm - quick LLM for the terminal' >> "$rc_file"
      echo "alias llm='shellm'" >> "$rc_file"
      echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$rc_file"
      echo "Added alias to $rc_file"
    else
      echo "Alias already in $rc_file"
    fi
  fi
}

add_alias "$HOME/.bashrc"
add_alias "$HOME/.zshrc"

# Install imgcat if not present
if [ ! -f "$BIN_DIR/imgcat" ]; then
  cat > "$BIN_DIR/imgcat" << 'IMGCAT_EOF'
#!/usr/bin/env bash
# imgcat - display images inline in iTerm2/compatible terminals
# Based on iTerm2's imgcat

if [ -t 0 ]; then
  has_stdin=f
else
  has_stdin=t
fi

tmux_passthrough=""
if [ -n "${TMUX:-}" ]; then
  tmux_passthrough="\ePtmux;\e"
fi

print_osc() {
  if [ -n "$tmux_passthrough" ]; then
    printf "\ePtmux;\e\e]"
  else
    printf "\e]"
  fi
}

print_st() {
  if [ -n "$tmux_passthrough" ]; then
    printf "\a\e\\"
  else
    printf "\a"
  fi
}

show_help() {
  echo "Usage: imgcat [-p] [-u URL] [-w N] [-h N] [filename]"
  echo "  -p          Print filename"
  echo "  -u URL      Display image from URL"
  echo "  -w N        Max width (cells or px or %)"
  echo "  -h N        Max height"
}

print_image() {
  local data=""
  if [ -n "$1" ] && [ "$1" != "-" ]; then
    if [ -f "$1" ]; then
      data=$(base64 < "$1")
    elif [[ "$1" == http* ]]; then
      data=$(curl -sL "$1" | base64)
    fi
  elif [ "$has_stdin" = t ]; then
    data=$(base64)
  fi

  if [ -z "$data" ]; then
    echo "imgcat: no image data" >&2
    return 1
  fi

  print_osc
  printf "1337;File=inline=1"
  [ -n "${img_width:-}" ] && printf ";width=%s" "$img_width"
  [ -n "${img_height:-}" ] && printf ";height=%s" "$img_height"
  printf ":"
  printf "%s" "$data"
  print_st
  printf "\n"
}

img_width=""
img_height=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    -w) shift; img_width="$1" ;;
    -h) shift; img_height="$1" ;;
    -u) shift; print_image "$1"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) print_image "$1"; exit 0 ;;
  esac
  shift
done

if [ "$has_stdin" = t ]; then
  print_image "-"
fi
IMGCAT_EOF
  chmod +x "$BIN_DIR/imgcat"
  echo "Installed imgcat to $BIN_DIR/imgcat"
fi

echo ""
echo "shellm installed successfully!"
echo "  Binary: $BIN_DIR/shellm"
echo "  Config: $SHELLM_DIR/.env"
echo "  Data:   $SHELLM_DIR/"
echo ""
echo "Restart your shell or run:"
echo "  source ~/.zshrc  (or ~/.bashrc)"
echo ""
echo "Then try:"
echo "  llm config"
echo "  llm \"hello, what can you do?\""
