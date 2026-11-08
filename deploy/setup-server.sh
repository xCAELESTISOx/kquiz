#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server. Run as root from /opt/kquiz/deploy.
# DOCKER_MIRROR=https://... sets a Docker Hub mirror (for networks where Docker Hub is blocked or rate-limited).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root" >&2; exit 1; }
cd "$(dirname "$0")"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y docker.io docker-compose-v2 ufw sqlite3 rsync unattended-upgrades
if [ -n "${DOCKER_MIRROR:-}" ]; then
  mkdir -p /etc/docker
  printf '{ "registry-mirrors": ["%s"] }\n' "$DOCKER_MIRROR" > /etc/docker/daemon.json
fi
systemctl enable docker
systemctl restart docker

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
install -d -m 700 /srv/kquiz/backups

install -m 644 kquiz-backup.service kquiz-backup.timer kquiz-update.service kquiz-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kquiz-backup.timer kquiz-update.timer

./firewall.sh
echo "Server ready. Next: deploy/.env and docker compose up -d --build (docs/DEPLOY.md)."
