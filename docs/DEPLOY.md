# Self-hosting KQuiz

KQuiz runs on one Linux server with Docker Compose: Caddy (HTTPS and the static PWA), the API (Node + SQLite) and the scorer (pronunciation scoring and TTS, Python). Any VPS provider works; nothing in [`deploy/`](../deploy) depends on a particular one.

```
phone / browser, Claude ──HTTPS (Let's Encrypt)──▶ your-server :443
                                                    Caddy ─▶ api (127.0.0.1:8787) ─▶ SQLite
                                                      │            └─▶ scorer (127.0.0.1:8788)
                                                      └─▶ static PWA
```

## Requirements

- A server with **Ubuntu 24.04**, 2 vCPU and **4 GB of RAM** (the scoring model alone takes about 2 GB; see [Scorer and audio](#scorer-and-audio)). About 10 GB of free disk for images and models.
- A domain (or subdomain) with an A record pointing at the server. Passkeys are bound to this host name, so pick one you intend to keep.
- Ports 80 and 443 reachable from the internet (Let's Encrypt uses port 80 for its challenge).

## What is in `deploy/`

| File | Purpose |
|---|---|
| `docker-compose.yml` | Three containers: `caddy`, `api`, `scorer`. Host network, read-only file systems, memory limits |
| `Caddyfile` | HTTPS from Let's Encrypt, timeouts, 2 MB body limit; `/api`, `/mcp`, `/oauth`, `/.well-known` go to the API, everything else to the PWA with `index.html` for any client path (needed for `/login`) |
| `.env.example` | Template for `deploy/.env`: domain, e-mail for the certificate, the origin secret, the first-sign-in code |
| `setup-server.sh` | One-time setup of a fresh server: Docker, firewall, SSH keys only, swap, data folders, backup and update timers |
| `firewall.sh` | `ufw`: only 22 (key only, or only from `SSH_FROM`), 80 and 443 are open |
| `cloud-init.sh` | Prints cloud-init user-data that does the whole manual install below on a new server's first boot |
| `update.sh` + `kquiz-update.timer` | Every 10 minutes: if `main` moved, back up, pull the prebuilt images for that commit and restart (see [Updates](#updates)) |
| `backup.sh` + `kquiz-backup.timer` | Nightly copy of the database to `/srv/kquiz/backups`, kept for 30 days |
| `smoke-test.sh` | Builds and starts the whole stack locally with a self-signed certificate and checks it; CI runs it |
| `Dockerfile.{api,caddy,scorer}` | Image builds; the build context is the repository root |

## Configuration

`deploy/.env` (copy from `.env.example`, keep it `chmod 600`; it is git-ignored):

| Variable | Required | Meaning |
|---|---|---|
| `DOMAIN` | yes | Host name without `https://`, e.g. `kquiz.example.com`. The API's public origin becomes `https://$DOMAIN` |
| `ACME_EMAIL` | yes | E-mail for Let's Encrypt expiry notices. `internal` makes Caddy use its own self-signed CA (local tests only) |
| `ORIGIN_SECRET` | yes | At least 32 random characters: `openssl rand -hex 32`. Caddy adds it to every request it forwards; the API refuses requests without it |
| `SETUP_CODE` | no | One-time code (16+ characters) for binding the first passkey. If unset, the API prints a random one to its log |
| `KQUIZ_DATA` | no | Database folder on the host, default `/srv/kquiz/data` |
| `KQUIZ_REGISTRY` | no | Where prebuilt images are pulled from, default the upstream project's GHCR namespace. Set it to `ghcr.io/<your-github-user>` if you publish images from your own fork |
| `KQUIZ_TAG` | no | Image tag; `update.sh` writes it for you |
| `SCORER_LOAD_MODEL` | no | `0` runs the scorer without the scoring model (only g2p and TTS work); saves ~2 GB of RAM |

Other API settings (`TIME_ZONE`, `MCP_REDIRECT_URIS`, ...) are read from the same `.env`, since it is passed to the `api` container; they are listed in [`apps/api/README.md`](../apps/api/README.md#environment). Scorer settings (`TTS_VOICE`, `SCORER_THREADS`, ...) go under `scorer.environment` in `docker-compose.yml`; see [`services/scorer/README.md`](../services/scorer/README.md).

## Manual install

1. Create the server with your SSH key and point the domain's A record at its IP.
2. On the server, as root:

```sh
git clone https://github.com/<your-github-user>/kquiz.git /opt/kquiz
cd /opt/kquiz/deploy
./setup-server.sh              # if Docker Hub is unreachable: DOCKER_MIRROR=https://<mirror> ./setup-server.sh
cp .env.example .env && nano .env && chmod 600 .env
./update.sh                    # pulls prebuilt images, or builds locally if the registry can't be reached
docker compose logs api | grep 'setup code'    # only if SETUP_CODE is not set
```

The repository must stay at `/opt/kquiz`: the systemd units call `/opt/kquiz/deploy/*.sh`. `setup-server.sh` also restricts SSH to keys only, so make sure your key works before running it.

To build everything on the server instead of pulling images: `docker compose up -d --build` (slow: the scorer image includes PyTorch).

## Automated install with cloud-init

`cloud-init.sh` prints user-data that clones the repository, runs `setup-server.sh`, writes `deploy/.env` and starts the stack. Paste its output as user-data when creating the server in your provider's panel or API.

```sh
DOMAIN=kquiz.example.com ACME_EMAIL=you@example.com \
ORIGIN_SECRET=$(openssl rand -hex 32) SETUP_CODE=$(openssl rand -hex 12) \
REPO=https://github.com/<your-github-user>/kquiz.git \
deploy/cloud-init.sh > user-data.yaml
```

`REPO` defaults to the upstream repository; point it at your fork if you have one. Keep the generated user-data private: it contains the origin secret and the setup code.

**Private fork.** To deploy from a private repository, also pass `DEPLOY_KEY_FILE`, a private key whose public half is added as a read-only deploy key (GitHub → repository → Settings → Deploy keys → Add deploy key, leave "Allow write access" off), and use the SSH address: `REPO=git@github.com:<your-github-user>/kquiz.git`. The server can then pull the code and do nothing else; the user-data then contains the key too.

## First sign-in and connecting Claude

1. Open `https://<your-domain>` in any modern browser, enter the setup code and create a passkey. The code works once.
2. Install it as an app if you like: on iPhone, Safari → Share → **Add to Home Screen**; on Android, Chrome → menu → **Install app**; on desktop, the install icon in Chrome or Edge's address bar.
3. In Claude: Settings → Connectors → **Add custom connector**, URL `https://<your-domain>/mcp`, then confirm with your passkey on the consent page.

To let other people in, create an invite link in the app (owner only). Up to four members, each with their own cards; each can connect their own Claude.

## Updates

GitHub Actions (the `images` job in [`ci.yml`](../.github/workflows/ci.yml)) builds the three images after every check has passed on a commit to `main` and pushes them to GHCR as `ghcr.io/<owner>/kquiz-{api,caddy,scorer}`, tagged `sha-<commit>` and `main`. The server never builds in the normal case; it only downloads the layers that changed, so an update takes minutes.

`update.sh --if-changed` runs from `kquiz-update.timer` every 10 minutes and follows `origin/main` of the clone in `/opt/kquiz`:

- `main` hasn't moved: nothing happens.
- The registry answers but has no images for the new commit yet (CI still running or failed): it waits and tries again on the next run, so a red commit never reaches the server.
- The registry can't be reached (network, or private images without `docker login`): it builds locally, which is slow but still updates the site.
- Before restarting it backs the database up; migrations run when the new API starts.
- The tag of the running images is written to `deploy/.env` (`KQUIZ_TAG`), so manual `docker compose ...` commands use the same images.

Run `/opt/kquiz/deploy/update.sh` to update right away. If you'd rather update by hand, disable the timer: `systemctl disable --now kquiz-update.timer`.

**Private images.** If your images on GHCR are private, log the server in with a classic personal access token that has only `read:packages` (GHCR doesn't accept fine-grained tokens):

```sh
docker login ghcr.io -u <your-github-user>     # paste the token at the Password: prompt
```

Docker keeps the login in `/root/.docker/config.json`, where `update.sh` finds it. Alternatively make the three packages public (Package settings → Change visibility). Until the server can pull, it builds locally.

## Maintenance

| Task | Command |
|---|---|
| Update now | `/opt/kquiz/deploy/update.sh` |
| Logs | `cd /opt/kquiz/deploy && docker compose logs -f --tail 100` |
| Back up now | `/opt/kquiz/deploy/backup.sh` |
| Copy backups to your computer | `scp 'root@your-server:/srv/kquiz/backups/*' .` |

**Restore from a backup:**

```sh
cd /opt/kquiz/deploy
docker compose stop api
gunzip -c /srv/kquiz/backups/kquiz-<timestamp>.db.gz > /srv/kquiz/data/kquiz.db
rm -f /srv/kquiz/data/kquiz.db-wal /srv/kquiz/data/kquiz.db-shm
chown 1000:1000 /srv/kquiz/data/kquiz.db
docker compose start api
```

**Off-server backups (optional).** Put `BACKUP_REMOTE=user@backup-host:kquiz` (and `BACKUP_REMOTE_PORT`, default 23) in `/etc/kquiz-backup.env`, and `backup.sh` will rsync the archives there over SSH. The server's root SSH key must be authorized on that host.

## Scorer and audio

**Pronunciation scoring.** On first start the `scorer` container downloads the scoring model (about 1.3 GB) into the `scorer-models` volume; later updates leave it alone. In memory the model takes about 2 GB, which is why the server needs 4 GB (`setup-server.sh` also adds 2 GB of swap). With `SCORER_LOAD_MODEL=0` the stack fits in 2 GB, but recordings can't be scored.

**Card audio.** The same container voices cards with Supertonic 3 (`POST /tts`, [`app/tts.py`](../services/scorer/app/tts.py)). The TTS model (about 400 MB) is downloaded into the same volume on first use. It takes about 500 MB of memory only while voicing and is unloaded after 5 idle minutes (`TTS_IDLE`). Every 10 seconds the API looks for cards without audio, or whose Korean text changed, asks for MP3s one at a time and stores them in SQLite (`card_audio`), so the audio is part of every backup. Until a file exists, the app falls back to the phone's own voice. `TTS_VOICE` (default `F1`), `TTS_SPEED` (`0.7`, the model's minimum) and `TTS_STEPS` (`32`) set the voice; files made before a change are not redone. Once everything else is voiced, the same worker also records card and drill words in the voices M1, F3 and M3 (`voice_audio`, list in [`voices.ts`](../apps/api/src/voices.ts)); listening practice and sound drills pick one of the ready voices at random.

## How the server is protected

- Only Caddy (80 and 443) and SSH (keys only) are open. The API and the scorer listen on `127.0.0.1`.
- The API accepts only requests that carry the secret header Caddy adds, and takes the client IP from a header Caddy sets, so clients can't fake their IP to get around the rate limits.
- API rate limits: sign-in 5 a minute, the rest of the API 300 a minute, MCP and OAuth separately. Caddy cuts off bodies over 2 MB and slow connections.
- Containers run without root (except Caddy, which keeps only the right to bind ports 80 and 443), with read-only file systems, memory limits and at most 30 MB of logs each, so a flood of requests can't fill the disk.
- Cost: pick a fixed-price plan with traffic included. Then the server can't cost more than its plan, whatever traffic it gets.

## Running locally

For development you don't need Docker:

```sh
pnpm install
pnpm dev     # API on http://127.0.0.1:8787, web on http://localhost:5173 (proxies /api)
```

The API prints a one-time setup code on first start; open http://localhost:5173 and bind a passkey with it (browsers allow passkeys on `localhost` without HTTPS). The scorer is optional in development and runs separately; see [`services/scorer/README.md`](../services/scorer/README.md). To try the production stack on your machine, run `deploy/smoke-test.sh` (needs Docker, curl, sqlite3 and openssl).
