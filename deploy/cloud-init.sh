#!/usr/bin/env bash
# Prints cloud-init user-data that turns a fresh Ubuntu 24.04 VPS into a running KQuiz:
# clone the repo, run setup-server.sh, write deploy/.env, start the stack (prebuilt images, or a local build).
# Pass it as user-data when creating the server through the provider's API or panel.
#
# Required env: DOMAIN, ACME_EMAIL, ORIGIN_SECRET, SETUP_CODE
# Optional env: DOCKER_MIRROR,
#   REPO (default https://github.com/xCAELESTISOx/kquiz.git; point it at your fork),
#   DEPLOY_KEY_FILE: only for a private repo, a private key whose public half is a read-only deploy key
#   of the repository (GitHub → Settings → Deploy keys); then REPO must be the git@github.com:… address.
set -euo pipefail
: "${DOMAIN:?}" "${ACME_EMAIL:?}" "${ORIGIN_SECRET:?}" "${SETUP_CODE:?}"
DEPLOY_KEY_FILE=${DEPLOY_KEY_FILE:-}
[ -z "$DEPLOY_KEY_FILE" ] || [ -r "$DEPLOY_KEY_FILE" ] || { echo "Cannot read $DEPLOY_KEY_FILE" >&2; exit 1; }
REPO=${REPO:-https://github.com/xCAELESTISOx/kquiz.git}

indent() { sed 's/^/      /'; }

deploy_key() {
  [ -n "$DEPLOY_KEY_FILE" ] || return 0
  cat <<KEY
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
KEY
}

cat <<YAML
#cloud-config
write_files:
$(deploy_key)
  - path: /root/kquiz.env
    permissions: "0600"
    content: |
$(printf 'DOMAIN=%s\nACME_EMAIL=%s\nORIGIN_SECRET=%s\nSETUP_CODE=%s\n' "$DOMAIN" "$ACME_EMAIL" "$ORIGIN_SECRET" "$SETUP_CODE" | indent)
runcmd:
  - [env, HOME=/root, git, clone, "$REPO", /opt/kquiz]
  - [env, "DOCKER_MIRROR=${DOCKER_MIRROR:-}", /opt/kquiz/deploy/setup-server.sh]
  - [mv, /root/kquiz.env, /opt/kquiz/deploy/.env]
  - [/opt/kquiz/deploy/update.sh]
YAML
