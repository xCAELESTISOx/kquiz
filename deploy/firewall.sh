#!/usr/bin/env bash
# Opens 80 and 443 (Caddy) to everyone, SSH to everyone (key only) or only to SSH_FROM.
# Everything else is closed; the API and the scorer listen on 127.0.0.1 anyway.
# Usage: sudo ./firewall.sh            or  sudo SSH_FROM=203.0.113.7 ./firewall.sh
set -euo pipefail

ufw default deny incoming
ufw default allow outgoing
if [ -n "${SSH_FROM:-}" ]; then
  ufw allow proto tcp from "$SSH_FROM" to any port 22 comment ssh
else
  ufw limit 22/tcp comment ssh
fi
ufw allow 80/tcp comment caddy
ufw allow 443/tcp comment caddy
ufw --force enable
ufw status verbose
