#!/usr/bin/env bash
# Brings the server to the latest main: back up, rebuild, restart.
# With --if-changed (run by kquiz-update.timer) it does nothing while main hasn't moved.
set -euo pipefail

# Wrapped in a function so bash reads the whole script before git replaces this file.
main() {
  cd "$(dirname "$0")"
  git -C .. fetch -q origin main
  if [ "${1:-}" = --if-changed ] && [ "$(git -C .. rev-parse HEAD)" = "$(git -C .. rev-parse origin/main)" ]; then
    return 0
  fi
  git -C .. merge -q --ff-only origin/main
  ./backup.sh
  docker compose up -d --build --remove-orphans
  docker image prune -f
  docker compose ps
}
main "$@"
