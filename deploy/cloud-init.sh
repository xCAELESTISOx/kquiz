#!/usr/bin/env bash
# Prints cloud-init user-data that turns a fresh Ubuntu 24.04 VPS into a running KQuiz:
# clone the repo, run setup-server.sh, write deploy/.env, start the stack.
# Pass it as user-data when creating the server through the provider's API or panel.
#
# Required env: DOMAIN, ACME_EMAIL, ORIGIN_SECRET, SETUP_CODE,
#   DEPLOY_KEY_FILE: private key whose public half is a read-only deploy key of the repository
#   (GitHub → Settings → Deploy keys), so the server can pull a private repo and nothing else.
# Optional env: DOCKER_MIRROR, REPO (default git@github.com:xCAELESTISOx/kquiz.git)
set -euo pipefail
: "${DOMAIN:?}" "${ACME_EMAIL:?}" "${ORIGIN_SECRET:?}" "${SETUP_CODE:?}" "${DEPLOY_KEY_FILE:?}"
[ -r "$DEPLOY_KEY_FILE" ] || { echo "Cannot read $DEPLOY_KEY_FILE" >&2; exit 1; }
REPO=${REPO:-git@github.com:xCAELESTISOx/kquiz.git}

indent() { sed 's/^/      /'; }

cat <<YAML
#cloud-config
write_files:
  - path: /root/.ssh/kquiz_deploy
    permissions: "0600"
    content: |
$(indent < "$DEPLOY_KEY_FILE")
  - path: /root/.ssh/config
    permissions: "0600"
    append: true
    content: |
      Host github.com
        IdentityFile /root/.ssh/kquiz_deploy
        IdentitiesOnly yes
  - path: /root/.ssh/known_hosts
    permissions: "0644"
    append: true
    content: |
      github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
  - path: /root/kquiz.env
    permissions: "0600"
    content: |
$(printf 'DOMAIN=%s\nACME_EMAIL=%s\nORIGIN_SECRET=%s\nSETUP_CODE=%s\n' "$DOMAIN" "$ACME_EMAIL" "$ORIGIN_SECRET" "$SETUP_CODE" | indent)
runcmd:
  - [env, HOME=/root, git, clone, "$REPO", /opt/kquiz]
  - [env, "DOCKER_MIRROR=${DOCKER_MIRROR:-}", /opt/kquiz/deploy/setup-server.sh]
  - [mv, /root/kquiz.env, /opt/kquiz/deploy/.env]
  - [sh, -c, "cd /opt/kquiz/deploy && docker compose up -d --build"]
YAML
