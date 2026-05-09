#!/usr/bin/env bash
# Start mollama server (loads .env automatically, logs to /tmp/mollama.log)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="/tmp/mollama.pid"
LOG_FILE="/tmp/mollama.log"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$PROJECT_DIR"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    printf "${YELLOW}[mollama] Server is already running (PID %s).${NC}\n" "$OLD_PID"
    printf "  To restart: %s./scripts/stop-server.sh && ./scripts/start-server.sh%s\n" "${GREEN}" "${NC}"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# Check port
if lsof -i :11434 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  printf "${RED}[mollama] Port 11434 is already in use.${NC}\n"
  printf "  Find the process: lsof -i :11434 -sTCP:LISTEN -n -P\n"
  printf "  Or run: ./scripts/stop-server.sh\n"
  exit 1
fi

# Build if dist is missing
if [ ! -f "$PROJECT_DIR/dist/cli.js" ]; then
  printf "${YELLOW}[mollama] dist/ not found, building...${NC}\n"
  npm run build
fi

# Start the server in background, log output
nohup node dist/cli.js start --config config/system.json > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait a moment and check it's alive
sleep 1
if kill -0 "$SERVER_PID" 2>/dev/null; then
  printf "${GREEN}[mollama] Server started (PID %s)${NC}\n" "$SERVER_PID"
  printf "  Listening on: ${GREEN}http://127.0.0.1:11434${NC}\n"
  printf "  Log file:     %s\n" "$LOG_FILE"
  printf "  Stop:         ./scripts/stop-server.sh\n"
else
  printf "${RED}[mollama] Server failed to start. Check logs:${NC}\n"
  cat "$LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
