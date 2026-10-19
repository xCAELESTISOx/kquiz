#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server. Run as root from /opt/kquiz/deploy.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root" >&2; exit 1; }
cd "$(dirname "$0")"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y docker.io docker-compose-v2 ufw sqlite3 rsync unattended-upgrades
systemctl enable --now docker

# SSH: keys only.
cat > /etc/ssh/sshd_config.d/10-kquiz.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
systemctl reload ssh

# Swap keeps the box alive if the scorer model is enabled on a 4 GB server.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Data belongs to uid 1000 (the "node" user inside the API container).
install -d -m 750 -o 1000 -g 1000 /srv/kquiz/data
install -d -m 700 /srv/kquiz/backups /srv/kquiz/certs

install -m 644 kquiz-backup.service kquiz-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kquiz-backup.timer

./firewall.sh
echo "Server ready. Next: certificate and deploy/.env (docs/DEPLOY.md, step 5)."
