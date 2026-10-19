#!/usr/bin/env bash
# Builds and starts the stack with a self-signed certificate on this machine, checks what
# Cloudflare and the iPhone would see, then tears it down. Used by CI; needs docker, curl, sqlite3, openssl.
set -euo pipefail
cd "$(dirname "$0")"

work=$(mktemp -d)
ORIGIN_SECRET=$(openssl rand -hex 32)
export DOMAIN=kquiz.test ORIGIN_SECRET KQUIZ_DATA=$work/data KQUIZ_CERTS=$work/certs
mkdir -p "$KQUIZ_DATA" "$KQUIZ_CERTS"
chmod 777 "$KQUIZ_DATA"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" \
  -keyout "$KQUIZ_CERTS/origin.key" -out "$KQUIZ_CERTS/origin.pem" 2>/dev/null
chmod 644 "$KQUIZ_CERTS/origin.key"

cleanup() { docker compose logs --no-color > "$work/compose.log" 2>&1 || true; docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker compose up -d --build --wait

fail=0
check() { # name expected-status path [curl args...]
  local name=$1 want=$2 path=$3; shift 3
  local got
  got=$(curl -sk --noproxy "*" -o "$work/body" -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "$@" "https://$DOMAIN$path" || true)
  if [ "$got" = "$want" ]; then echo "ok   $name ($got)"; else echo "FAIL $name: want $want, got $got"; fail=1; fi
}
cf=(-H "x-kquiz-origin: $ORIGIN_SECRET" -H "cf-connecting-ip: 198.51.100.1")

check "app shell" 200 /
grep -q 'id="root"' "$work/body" || { echo "FAIL / is not index.html"; fail=1; }
check "SPA path /login gets index.html" 200 "/login?fresh=1&return_to=/oauth/authorize"
grep -q 'id="root"' "$work/body" || { echo "FAIL /login is not index.html"; fail=1; }
check "manifest" 200 /manifest.webmanifest
check "health without Cloudflare header" 200 /api/health
check "API without Cloudflare header" 403 /api/auth/status
check "API with wrong secret" 403 /api/auth/status -H "x-kquiz-origin: nope" -H "cf-connecting-ip: 198.51.100.1"
check "API through Cloudflare" 200 /api/auth/status "${cf[@]}"
grep -q '"setupRequired":true' "$work/body" || { echo "FAIL setupRequired is not true"; fail=1; }
check "MCP without Cloudflare header" 403 /mcp -X POST
check "MCP without token" 401 /mcp -X POST "${cf[@]}"
check "OAuth metadata" 200 /.well-known/oauth-authorization-server "${cf[@]}"
head -c 3000000 /dev/zero > "$work/big"
check "oversized body" 413 /api/cards -X POST "${cf[@]}" -H "content-type: application/json" --data-binary "@$work/big"

if curl -s --noproxy "*" -o /dev/null --max-time 2 http://127.0.0.1:80/; then echo "FAIL port 80 is open"; fail=1; else echo "ok   nothing on port 80"; fi
if ss -ltn | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]):8787$'; then echo "FAIL API listens publicly"; fail=1; else echo "ok   API only on 127.0.0.1"; fi
# Not piped into grep -q: with pipefail an early grep exit fails the pipeline.
docker compose logs api > "$work/api.log" 2>&1
if grep -q 'One-time setup code' "$work/api.log"; then echo "ok   setup code in the log"; else echo "FAIL no setup code in the log"; fail=1; fi

KQUIZ_BACKUPS=$work/backups ./backup.sh >/dev/null
if ls "$work"/backups/kquiz-*.db.gz >/dev/null 2>&1; then echo "ok   backup written"; else echo "FAIL no backup"; fail=1; fi

[ "$fail" = 0 ] || { cleanup; cat "$work/compose.log"; exit 1; }
echo "All checks passed"
