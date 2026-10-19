#!/usr/bin/env bash
# Builds and starts the stack on this machine with Caddy's internal (self-signed) CA instead of
# Let's Encrypt, checks what the iPhone and Claude would see, then tears it down.
# Used by CI; needs docker, curl, sqlite3, openssl.
set -euo pipefail
cd "$(dirname "$0")"

work=$(mktemp -d)
ORIGIN_SECRET=$(openssl rand -hex 32)
# The scorer runs without its model here: /g2p still works, and CI skips a 1.3 GB download.
export DOMAIN=kquiz.test ACME_EMAIL=internal ORIGIN_SECRET KQUIZ_DATA=$work/data SCORER_LOAD_MODEL=0
mkdir -p "$KQUIZ_DATA"
chmod 777 "$KQUIZ_DATA"

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

check "app shell" 200 /
grep -q 'id="root"' "$work/body" || { echo "FAIL / is not index.html"; fail=1; }
check "SPA path /login gets index.html" 200 "/login?fresh=1&return_to=/oauth/authorize"
grep -q 'id="root"' "$work/body" || { echo "FAIL /login is not index.html"; fail=1; }
check "manifest" 200 /manifest.webmanifest
check "health" 200 /api/health
check "API through Caddy" 200 /api/auth/status -H "x-kquiz-origin: nope"
grep -q '"setupRequired":true' "$work/body" || { echo "FAIL setupRequired is not true"; fail=1; }
check "MCP without token" 401 /mcp -X POST
check "OAuth metadata" 200 /.well-known/oauth-authorization-server
head -c 3000000 /dev/zero > "$work/big"
check "oversized body" 413 /api/cards -X POST -H "content-type: application/json" --data-binary "@$work/big"

got=$(curl -s --noproxy "*" -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $DOMAIN" http://127.0.0.1/login || true)
if [ "$got" = "308 https://$DOMAIN/login" ]; then echo "ok   http redirects to https"; else echo "FAIL http redirect: $got"; fail=1; fi
got=$(curl -s --noproxy "*" -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/auth/status || true)
if [ "$got" = 403 ]; then echo "ok   API refuses requests that bypass Caddy"; else echo "FAIL API without Caddy: $got"; fail=1; fi
got=""
for _ in $(seq 60); do
  got=$(curl -s --noproxy "*" 'http://127.0.0.1:8788/g2p?text=%EA%B5%AD%EB%AC%BC' || true)
  case $got in *'"pronunciation":"궁물"'*) break ;; esac
  sleep 2
done
case $got in *'"pronunciation":"궁물"'*) echo "ok   scorer answers /g2p" ;; *) echo "FAIL scorer /g2p: $got"; fail=1 ;; esac
if ss -ltn | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]):8788$'; then echo "FAIL scorer listens publicly"; fail=1; fi
if ss -ltn | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]):8787$'; then echo "FAIL API listens publicly"; fail=1; else echo "ok   API only on 127.0.0.1"; fi
# Not piped into grep -q: with pipefail an early grep exit fails the pipeline.
docker compose logs api > "$work/api.log" 2>&1
if grep -q 'One-time setup code' "$work/api.log"; then echo "ok   setup code in the log"; else echo "FAIL no setup code in the log"; fail=1; fi

KQUIZ_BACKUPS=$work/backups ./backup.sh >/dev/null
if ls "$work"/backups/kquiz-*.db.gz >/dev/null 2>&1; then echo "ok   backup written"; else echo "FAIL no backup"; fail=1; fi

[ "$fail" = 0 ] || { cleanup; cat "$work/compose.log"; exit 1; }
echo "All checks passed"
