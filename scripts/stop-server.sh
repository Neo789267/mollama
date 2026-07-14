#!/usr/bin/env bash
# Stop mollama server
set -euo pipefail

PID_FILE="/tmp/mollama.pid"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "$PID_FILE" ]; then
  # PID file missing — try finding by port
  PID=$(lsof -i :11434 -sTCP:LISTEN -n -P -t 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    printf "${GREEN}[mollama] Stopped server (PID %s, found via port 11434)${NC}\n" "$PID"
  else
    printf "${YELLOW}[mollama] No running server found.${NC}\n"
  fi
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill "$PID" 2>/dev/null; then
  printf "${GREEN}[mollama] Server stopped (PID %s)${NC}\n" "$PID"
  rm -f "$PID_FILE"
else
  printf "${YELLOW}[mollama] PID %s was not running — removing stale PID file${NC}\n" "$PID"
  rm -f "$PID_FILE"
  # Also try port-based kill
  PORT_PID=$(lsof -i :11434 -sTCP:LISTEN -n -P -t 2>/dev/null || true)
  if [ -n "$PORT_PID" ]; then
    kill "$PORT_PID" 2>/dev/null || true
    printf "${GREEN}[mollama] Stopped server (PID %s, found via port 11434)${NC}\n" "$PORT_PID"
  fi
fi
