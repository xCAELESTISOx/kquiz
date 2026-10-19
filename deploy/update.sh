#!/usr/bin/env bash
# Brings the server to the latest main: back up, pull the images CI built for that commit, restart.
# The images come from GHCR (.github/workflows/ci.yml publishes them after CI passes on main).
# If the registry can't be reached (network, or private images without docker login), it builds
# locally as before, which takes much longer.
# With --if-changed (run by kquiz-update.timer) it does nothing while main hasn't moved, and while
# the registry is reachable but has no images for the new commit yet (CI still running or red).
set -euo pipefail

# docker pull per image: docker compose pull may exit 0 on failures for services it can build.
pull_images() {
  local image
  for image in $(docker compose config --images); do
    docker pull -q "$image" >/dev/null || return 1
  done
}

# Wrapped in a function so bash reads the whole script before git replaces this file.
main() {
  cd "$(dirname "$0")"
  git -C .. fetch -q origin main
  local target build=()
  target=$(git -C .. rev-parse origin/main)
  if [ "${1:-}" = --if-changed ] && [ "$(git -C .. rev-parse HEAD)" = "$target" ]; then
    return 0
  fi

  export KQUIZ_TAG=sha-$target
  if pull_images; then
    echo "Pulled images for $target"
  elif [ "${1:-}" = --if-changed ] && docker manifest inspect "${KQUIZ_REGISTRY:-ghcr.io/xcaelestisox}/kquiz-api:main" >/dev/null 2>&1; then
    echo "No images for $target in the registry yet, will retry on the next run"
    return 0
  else
    echo "Registry unreachable or images missing, building locally"
    build=(--build)
  fi

  git -C .. merge -q --ff-only origin/main
  # Remember the tag so manual docker compose commands use the same images.
  touch .env
  sed -i '/^KQUIZ_TAG=/d' .env
  echo "KQUIZ_TAG=$KQUIZ_TAG" >> .env
  ./backup.sh
  docker compose up -d --remove-orphans "${build[@]}"
  # Images of earlier commits are no longer used by any container.
  docker image prune -af
  docker compose ps
}
main "$@"
