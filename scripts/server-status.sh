#!/usr/bin/env bash
# Check if mollama server is running
set -euo pipefail

PID_FILE="/tmp/mollama.pid"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

RUNNING=false
PID=""

# Check PID file
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    RUNNING=true
  fi
fi

# Also check the port
PORT_PID=$(lsof -i :11434 -sTCP:LISTEN -n -P -t 2>/dev/null || true)

if $RUNNING; then
  printf "${GREEN}[mollama] Server IS running${NC}\n"
  printf "  PID:      %s\n" "$PID"
  printf "  Endpoint: ${BLUE}http://127.0.0.1:11434${NC}\n"
elif [ -n "$PORT_PID" ]; then
  printf "${YELLOW}[mollama] Server IS running on port 11434 (PID %s) but PID file is stale${NC}\n" "$PORT_PID"
  printf "  Endpoint: ${BLUE}http://127.0.0.1:11434${NC}\n"
  echo "$PORT_PID" > "$PID_FILE"
else
  printf "${RED}[mollama] Server is NOT running${NC}\n"
  printf "  Start it: ./scripts/start-server.sh\n"
fi
