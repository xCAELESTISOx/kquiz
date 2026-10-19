#!/usr/bin/env bash
# Opens 443 only to Cloudflare's addresses, SSH to everyone (key only) or to SSH_FROM.
# Safe to re-run: it replaces the old Cloudflare rules with the current list.
# Usage: sudo ./firewall.sh            or  sudo SSH_FROM=203.0.113.7 ./firewall.sh
set -euo pipefail

ranges=$(curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6)
[ "$(echo "$ranges" | grep -c /)" -ge 10 ] || { echo "Could not fetch Cloudflare ranges" >&2; exit 1; }

ufw default deny incoming
ufw default allow outgoing
if [ -n "${SSH_FROM:-}" ]; then
  ufw allow proto tcp from "$SSH_FROM" to any port 22 comment ssh
else
  ufw allow 22/tcp comment ssh
fi

# Drop old Cloudflare rules (highest number first so numbering stays valid).
for n in $(ufw status numbered | sed -n 's/^\[ *\([0-9]*\)\].*# cloudflare$/\1/p' | sort -rn); do
  ufw --force delete "$n"
done
for ip in $ranges; do
  ufw allow proto tcp from "$ip" to any port 443 comment cloudflare
done

ufw --force enable
ufw status verbose
