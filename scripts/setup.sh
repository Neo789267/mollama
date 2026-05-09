#!/usr/bin/env bash
# ==============================================================================
# mollama + Neo-Mollama VS Code Copilot Chat Setup
# 
# This script automates the complete setup of mollama on a developer's machine
# so that VS Code Copilot Chat can use remote LLM models (DeepSeek, Kimi, etc.)
# through a local Ollama-compatible proxy.
#
# Usage:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
#   ./scripts/setup.sh --no-build        # skip rebuild (if already built)
#   ./scripts/setup.sh --server-only     # only start the server
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

# ----- color helpers -----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

info()    { printf "${BLUE}[mollama-setup]${NC} %s\n" "$*"; }
success() { printf "${GREEN}[mollama-setup]${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}[mollama-setup]${NC} %s\n" "$*"; }
error()   { printf "${RED}[mollama-setup]${NC} %s\n" "$*"; }
step()    { printf "\n${BOLD}${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$*"; }

# ----- parse flags -----
SKIP_BUILD=false
SERVER_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --no-build)     SKIP_BUILD=true ;;
    --server-only)  SERVER_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--no-build] [--server-only]"
      echo ""
      echo "Options:"
      echo "  --no-build      Skip the build step (use if dist/ is already up to date)"
      echo "  --server-only   Only start the server (assume everything else is done)"
      exit 0
      ;;
  esac
done

echo ""
printf "${BOLD}${GREEN}╔════════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║   🚀  Neo-Mollama  Environment Setup           ║${NC}\n"
printf "${BOLD}${GREEN}╚════════════════════════════════════════════════╝${NC}\n"
echo ""

# ===================== 1. Check prerequisites =====================
step "1/5  Checking prerequisites"

# Node.js >= 20
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Please install Node.js >= 20 from https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js >= 20 is required. Current version: $(node -v)"
  exit 1
fi
success "Node.js $(node -v)  ✓"

# npm
if ! command -v npm &>/dev/null; then
  error "npm is not installed."
  exit 1
fi
success "npm $(npm -v)  ✓"

# VS Code (optional – warn if missing)
if ! command -v code &>/dev/null; then
  warn "VS Code CLI ('code') not found in PATH. You can still use mollama, but"
  warn "the VS Code integration steps need to be done manually."
  warn "To add 'code' to PATH: open VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'"
else
  success "VS Code CLI found  ✓"
fi

if $SERVER_ONLY; then
  step "Skipping install/build (--server-only), jumping to server start"
  "$SCRIPT_DIR/start-server.sh"
  exit 0
fi

# ===================== 2. Create .env =====================
step "2/5  Setting up environment (.env)"

if [ -f "$ENV_FILE" ]; then
  info ".env already exists — skipping creation"
else
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    success "Created .env from .env.example"
    warn "⚠️  IMPORTANT: Edit .env and add your API keys!"
    warn "   open $ENV_FILE"
    echo ""
    printf "   ${YELLOW}Required keys:${NC}\n"
    printf "     DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx\n"
    printf "     (KIMI_API_KEY and MIMO_API_KEY are optional)\n"
  else
    # create a minimal .env
    cat > "$ENV_FILE" <<'ENVEOF'
# Neo-Mollama API Keys
# Fill in your actual keys below.
# DEEPSEEK_API_KEY is required for DeepSeek models.
# KIMI_API_KEY and MIMO_API_KEY are optional.

DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
KIMI_API_KEY=your-kimi-api-key-here
MIMO_API_KEY=your-mimo-api-key-here

# HTTPS_PROXY=http://proxy.example.com:8080
ENVEOF
    success "Created minimal .env"
    warn "⚠️  IMPORTANT: Edit .env and add your DEEPSEEK_API_KEY!"
    warn "   open $ENV_FILE"
  fi

  echo ""
  read -rp "Press Enter after you've saved your API keys (or Ctrl+C to abort)... "
fi

# Validate that at least DEEPSEEK_API_KEY looks non-empty
# (shellcheck disable=SC1090)
source "$ENV_FILE" 2>/dev/null || true
if [ -z "${DEEPSEEK_API_KEY:-}" ] || [ "$DEEPSEEK_API_KEY" = "sk-your-deepseek-api-key-here" ]; then
  warn "DEEPSEEK_API_KEY is not set or still has the placeholder value."
  warn "The server will start but DeepSeek requests will fail."
fi

# ===================== 3. Install dependencies =====================
step "3/5  Installing dependencies"

cd "$PROJECT_DIR"
npm install --loglevel=error
success "Dependencies installed  ✓"

# ===================== 4. Build =====================
if $SKIP_BUILD; then
  step "4/5  Skipping build (--no-build)"
else
  step "4/5  Building TypeScript"
  npm run build
  success "Build complete  ✓"
fi

# ===================== 5. Validate config =====================
step "5/5  Validating configuration"

# Run validation (ignore proxy warning – it's fine)
set +e
VALIDATION_OUTPUT=$(node dist/cli.js validate-config --config config/system.json 2>&1)
VALIDATION_EXIT=$?
set -e

echo "$VALIDATION_OUTPUT" | grep -v "HTTPS_PROXY" || true

if [ $VALIDATION_EXIT -eq 0 ]; then
  success "Configuration validated  ✓"
else
  warn "Configuration validation had warnings (see above)."
  warn "The server may still work — review the warnings."
fi

# ===================== Done – help text =====================
echo ""
printf "${BOLD}${GREEN}╔════════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║   ✅  Setup Complete!                          ║${NC}\n"
printf "${BOLD}${GREEN}╚════════════════════════════════════════════════╝${NC}\n"
echo ""

printf "${BOLD}To start the server:${NC}\n"
printf "  ${BLUE}./scripts/start-server.sh${NC}\n"
echo ""

printf "${BOLD}To add Neo-Mollama to VS Code Copilot Chat:${NC}\n"
printf "  1. Open VS Code Copilot Chat (Cmd+Shift+I or Ctrl+Shift+I)\n"
printf "  2. Click the ${BOLD}model selector${NC} dropdown at the bottom of the chat panel\n"
printf "  3. Choose ${BOLD}\"Add Model...\"${NC} or ${BOLD}\"Manage Models...\"${NC}\n"
printf "  4. Select ${BOLD}Ollama${NC} as the provider\n"
printf "  5. Enter the URL: ${BLUE}http://localhost:11434${NC}\n"
printf "  6. Name it: ${BLUE}Neo-Mollama${NC}\n"
printf "  7. After connection, select a model like ${BLUE}DeepSeek V4 Pro${NC} or ${BLUE}DeepSeek V4 Flash${NC}\n"
echo ""

printf "${BOLD}Quick reference:${NC}\n"
printf "  Start server:   ${BLUE}./scripts/start-server.sh${NC}\n"
printf "  Stop server:    ${BLUE}./scripts/stop-server.sh${NC}\n"
printf "  Server status:  ${BLUE}./scripts/server-status.sh${NC}\n"
printf "  View logs:      ${BLUE}tail -f /tmp/mollama.log${NC}\n"
echo ""
