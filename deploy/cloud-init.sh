#!/usr/bin/env bash
# Prints cloud-init user-data that turns a fresh Ubuntu 24.04 VPS into a running KQuiz:
# clone the repo, run setup-server.sh, write deploy/.env, start the stack.
# Pass it as user-data when creating the server through the provider's API or panel.
#
# Required env: DOMAIN, ACME_EMAIL, ORIGIN_SECRET, SETUP_CODE, GITHUB_TOKEN (read-only, contents of kquiz)
# Optional env: DOCKER_MIRROR, REPO (default github.com/xCAELESTISOx/kquiz)
set -euo pipefail
: "${DOMAIN:?}" "${ACME_EMAIL:?}" "${ORIGIN_SECRET:?}" "${SETUP_CODE:?}" "${GITHUB_TOKEN:?}"
REPO=${REPO:-github.com/xCAELESTISOx/kquiz}

indent() { sed 's/^/      /'; }

cat <<YAML
#cloud-config
write_files:
  - path: /root/.git-credentials
    permissions: "0600"
    content: |
$(printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" | indent)
  - path: /root/kquiz.env
    permissions: "0600"
    content: |
$(printf 'DOMAIN=%s\nACME_EMAIL=%s\nORIGIN_SECRET=%s\nSETUP_CODE=%s\n' "$DOMAIN" "$ACME_EMAIL" "$ORIGIN_SECRET" "$SETUP_CODE" | indent)
runcmd:
  - [git, config, --system, credential.helper, "store --file /root/.git-credentials"]
  - [git, clone, "https://$REPO.git", /opt/kquiz]
  - [env, "DOCKER_MIRROR=${DOCKER_MIRROR:-}", /opt/kquiz/deploy/setup-server.sh]
  - [mv, /root/kquiz.env, /opt/kquiz/deploy/.env]
  - [sh, -c, "cd /opt/kquiz/deploy && docker compose up -d --build"]
YAML
