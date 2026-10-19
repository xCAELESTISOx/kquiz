#!/usr/bin/env bash
# Pull main, back up, rebuild and restart. Run on the server from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
git -C .. pull --ff-only
./backup.sh
docker compose up -d --build
docker image prune -f
docker compose ps
