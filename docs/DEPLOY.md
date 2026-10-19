# Развёртывание KQuiz

Один VPS с фиксированной ценой у российского провайдера (по умолчанию Timeweb Cloud, Москва), оплата заранее с баланса. Потратить больше пополненного нельзя: атака может уронить приложение, но не увеличить счёт.

Cloudflare перед сервером не ставим: российские провайдеры обрывают соединения с ним, и приложение не открылось бы из России.

```
iPhone, Claude ──HTTPS (Let's Encrypt)──▶ сервер :443
                                          Caddy ─▶ api (127.0.0.1:8787) ─▶ SQLite
                                                └─▶ статика PWA
```

Что лежит в [`deploy/`](../deploy):

| Файл | Зачем |
|---|---|
| `docker-compose.yml` | Три контейнера: `caddy`, `api`, `scorer` (оценка произношения) |
| `Caddyfile` | HTTPS от Let's Encrypt, таймауты, лимит тела 2 МБ; `/api`, `/mcp`, `/oauth`, `/.well-known` в API, остальное — PWA с `index.html` на любые пути (нужно для `/login`) |
| `.env.example` | Шаблон настроек: домен, e-mail для сертификата, секрет, код первого входа |
| `cloud-init.sh` | Собирает user-data, с которым новый сервер сам ставит и запускает всё ниже |
| `setup-server.sh` | Один раз на новом сервере: Docker, firewall, SSH только по ключу, папки, бэкап и автообновление |
| `firewall.sh` | Открыты только 22 (только ключ), 80 и 443 |
| `backup.sh` + `kquiz-backup.timer` | Копия базы каждую ночь в `/srv/kquiz/backups`, хранится 30 дней |
| `update.sh` + `kquiz-update.timer` | Раз в 10 минут сервер сам проверяет `main` и обновляется, перед этим делает бэкап |
| `smoke-test.sh` | Проверка всей связки (её же запускает CI) |

## Что делает владелец

1. Зарегистрироваться на [timeweb.cloud](https://timeweb.cloud) и пополнить баланс.
2. Купить домен там же (раздел «Домены»), чтобы DNS был в той же панели и API.
3. Создать API-токен Timeweb Cloud (панель → API и Terraform) и добавить его в настройки облачного окружения Claude (Project settings → Cloud environment → шестерёнка → Network secrets): тип **Bearer**, хост `api.timeweb.cloud`. Там же в Allowed domains добавить `api.timeweb.cloud`.
4. Когда Claude пришлёт открытый ключ: GitHub → репозиторий `kquiz` → Settings → Deploy keys → Add deploy key, вставить ключ, галочку «Allow write access» **не ставить**. По этому ключу сервер забирает код, и больше он ничего не умеет.

Дальше Claude через API Timeweb создаёт сервер (Ubuntu 24.04, 4 ГБ, Москва) с user-data из `cloud-init.sh`, добавляет A-запись домена и проверяет, что сайт открылся по HTTPS. Код первого входа Claude задаёт сам (`SETUP_CODE`) и присылает владельцу.

## Первый вход и Claude

1. Открыть `https://<домен>` в Safari на iPhone, ввести код первого входа, создать passkey (Face ID). Код одноразовый.
2. Поделиться → **На экран «Домой»**.
3. claude.ai → Settings → Connectors → **Add custom connector**: URL `https://<домен>/mcp`, подтвердить passkey'ем.

## Ручная установка (если без API)

1. Создать сервер Ubuntu 24.04, 2 vCPU, 4 ГБ, со своим SSH-ключом. Направить A-запись домена на его IP.
2. На сервере:

```sh
git clone https://github.com/xCAELESTISOx/kquiz.git /opt/kquiz   # для приватного репозитория — с токеном
cd /opt/kquiz/deploy
./setup-server.sh            # если Docker Hub недоступен: DOCKER_MIRROR=<адрес зеркала провайдера> ./setup-server.sh
cp .env.example .env && nano .env && chmod 600 .env
docker compose up -d --build
docker compose logs api | grep 'setup code'   # если SETUP_CODE не задан
```

## Обслуживание

| Задача | Команда на сервере |
|---|---|
| Обновить сейчас, не дожидаясь таймера | `/opt/kquiz/deploy/update.sh` |
| Логи | `cd /opt/kquiz/deploy && docker compose logs -f --tail 100` |
| Бэкап вручную | `/opt/kquiz/deploy/backup.sh` |
| Скачать бэкапы к себе | `scp 'root@<IP>:/srv/kquiz/backups/*' .` (с компьютера) |

**Восстановление из бэкапа:**

```sh
cd /opt/kquiz/deploy
docker compose stop api
gunzip -c /srv/kquiz/backups/kquiz-<дата>.db.gz > /srv/kquiz/data/kquiz.db
rm -f /srv/kquiz/data/kquiz.db-wal /srv/kquiz/data/kquiz.db-shm
chown 1000:1000 /srv/kquiz/data/kquiz.db
docker compose start api
```

**Копия бэкапов вне сервера (по желанию).** Впиши в `/etc/kquiz-backup.env` `BACKUP_REMOTE=user@host:kquiz` (rsync по SSH, порт в `BACKUP_REMOTE_PORT`), и `backup.sh` будет копировать архивы туда.

**Оценка произношения.** Контейнер `scorer` при первом старте скачивает модель (около 1,3 ГБ) и держит её в памяти, около 2 ГБ. Поэтому серверу нужно 4 ГБ: на 2 ГБ модель не поместится вместе с остальным.

## Как устроена защита

- Наружу открыт только Caddy (80 и 443) и SSH по ключу. API и сервис оценки слушают `127.0.0.1`.
- API принимает только запросы с секретным заголовком, который добавляет Caddy, и берёт IP клиента из заголовка, который тоже ставит Caddy. Подделать IP, чтобы обойти лимиты, нельзя.
- Лимиты запросов в API: вход 5 в минуту, остальное API 300 в минуту, MCP и OAuth отдельно. Caddy режет тела больше 2 МБ и медленные соединения.
- Контейнеры без root-прав (кроме Caddy, которому оставлено только право занять порты 80 и 443), файловая система только для чтения, лимиты памяти, логи не больше 30 МБ на контейнер, чтобы поток запросов не забил диск.
- Бюджет: тариф с фиксированной ценой и оплата с баланса. Сервер не может стоить больше, чем на балансе.
