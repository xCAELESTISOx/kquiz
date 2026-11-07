#!/usr/bin/env bash
# One-time move of this server's data to the new server in migrate-target (2026-11, Moscow →
# Novosibirsk). backup.sh calls it with "schedule" after every backup; it then runs once, 60 s
# later in its own systemd unit, so the update.sh that called it has finished first.
# The run stops the stack, packs the database, deploy/.env, the deploy key and the ghcr.io login,
# encrypts them for migrate.pub and POSTs them to the receiver on the new server, which restores
# them and starts KQuiz there. If the upload fails, the stack and timers come back up here.
# Does nothing on the new server (/etc/kquiz-migrated-in) or once done (/srv/kquiz/.migrated-out).
set -euo pipefail
cd "$(dirname "$0")"
DONE=/srv/kquiz/.migrated-out
[ -e /etc/kquiz-migrated-in ] || [ -e "$DONE" ] || [ ! -s migrate-target ] && exit 0
TARGET=$(tr -d '[:space:]' < migrate-target)

if [ "${1:-}" = schedule ]; then
  systemd-run --unit=kquiz-migrate-out --on-active=60 "$PWD/migrate-out.sh" run >/dev/null 2>&1 || true
  exit 0
fi
[ "${1:-}" = run ] || { echo "Usage: $0 schedule|run" >&2; exit 1; }

exec >> /srv/kquiz/migrate-out.log 2>&1
set -x
W=$(mktemp -d /root/kquiz-migrate.XXXXXX)
restore() {
  rm -rf "$W"
  docker compose up -d || true
  systemctl start kquiz-update.timer kquiz-backup.timer || true
}
trap restore ERR

systemctl stop kquiz-update.timer kquiz-backup.timer
docker compose down
paths=(srv/kquiz/data opt/kquiz/deploy/.env)
for p in srv/kquiz/backups root/.ssh root/.docker etc/docker/daemon.json; do
  [ -e "/$p" ] && paths+=("$p")
done
tar czf "$W/data.tgz" --numeric-owner -C / "${paths[@]}"
openssl rand -hex 32 > "$W/key"
openssl pkeyutl -encrypt -pubin -inkey migrate.pub -pkeyopt rsa_padding_mode:oaep -in "$W/key" -out "$W/key.enc"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$W/key" -in "$W/data.tgz" -out "$W/data.enc"
cat "$W/key.enc" "$W/data.enc" > "$W/payload"
curl -fsS --retry 10 --retry-all-errors --retry-delay 30 --max-time 3600 \
  -H 'Content-Type: application/octet-stream' --data-binary "@$W/payload" "http://$TARGET:8099/upload"
trap - ERR
touch "$DONE"
systemctl disable kquiz-update.timer kquiz-backup.timer
rm -rf "$W"
echo "Moved to $TARGET"
