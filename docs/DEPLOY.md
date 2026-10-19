# Развёртывание KQuiz

Один сервер с фиксированной ценой, перед ним бесплатный Cloudflare. Сервер принимает соединения только от Cloudflare, поэтому атака может в худшем случае уронить приложение, но не увеличить счёт.

```
iPhone, Claude ──HTTPS──▶ Cloudflare ──HTTPS (Origin Certificate)──▶ сервер :443
                                                                     Caddy ─▶ api (127.0.0.1:8787) ─▶ SQLite
                                                                           └─▶ статика PWA
```

Что лежит в [`deploy/`](../deploy):

| Файл | Зачем |
|---|---|
| `docker-compose.yml` | Три контейнера: `caddy`, `api`, `scorer` (последний пока выключен) |
| `Caddyfile` | HTTPS, лимит тела 2 МБ, `/api`, `/mcp`, `/oauth`, `/.well-known` в API, остальное — PWA с `index.html` на любые пути (нужно для `/login`) |
| `.env.example` | Шаблон настроек: домен и секрет для Cloudflare |
| `setup-server.sh` | Один раз на новом сервере: Docker, firewall, SSH только по ключу, папки, ночной бэкап |
| `firewall.sh` | Порт 443 только для адресов Cloudflare, 22 для SSH |
| `backup.sh` + `kquiz-backup.timer` | Копия базы каждую ночь в `/srv/kquiz/backups`, хранится 30 дней |
| `update.sh` | Обновить приложение до свежего `main` |
| `smoke-test.sh` | Проверка всей связки (её же запускает CI) |

## Сколько стоит

| Что | Цена |
|---|---|
| Hetzner Cloud CX23 (2 vCPU, 4 ГБ, 40 ГБ, 20 ТБ трафика) | около 5,5 € в месяц + 0,5 € за IPv4 + НДС. Точную цену смотри на [hetzner.com/cloud](https://www.hetzner.com/cloud) |
| Бэкапы Hetzner (снимок сервера каждый день, 7 штук) | +20 % от цены сервера |
| Домен | от ~10 $ в год |
| Cloudflare Free | 0 |

Цена сервера фиксированная, за запросы ничего не берут. Трафик сверх 20 ТБ платный, но до сервера доходит только трафик через Cloudflare, а статику он кэширует.

## Шаги

### 1. Домен и Cloudflare

1. Заведи бесплатный аккаунт на [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Купи домен прямо в Cloudflare (Domain Registration → Register Domains, по себестоимости) или у любого регистратора и добавь его в Cloudflare (Add a domain → Free), затем поменяй NS-серверы у регистратора на те, что покажет Cloudflare.

Дальше в тексте домен приложения — `kquiz.example.com`. Можно использовать сам домен или поддомен.

### 2. Сервер

1. Аккаунт на [Hetzner Cloud](https://console.hetzner.cloud), новый проект.
2. Add Server: локация любая в Европе, образ **Ubuntu 24.04**, тип **CX23** (Shared vCPU, x86), IPv4 включён, добавь свой SSH-ключ, включи **Backups**.
3. Запиши IPv4 сервера.

### 3. DNS и сертификат в Cloudflare

1. DNS → Records → Add record: тип `A`, имя `kquiz` (или `@` для самого домена), IPv4 сервера, **Proxied** (оранжевое облако).
2. SSL/TLS → Overview: режим **Full (strict)**.
3. SSL/TLS → Edge Certificates: **Always Use HTTPS** включить, Minimum TLS Version **1.2**.
4. SSL/TLS → Origin Server → **Create Certificate**: RSA, hostnames `kquiz.example.com`, срок 15 лет. Не закрывай окно: понадобятся оба текста (Origin Certificate и Private key) на шаге 5.

### 4. Секрет, без которого сервер не ответит

1. Придумай секрет: `openssl rand -hex 32` (на Mac или на сервере).
2. Rules → Transform Rules → **Modify Request Header** → Create rule:
   - имя `kquiz origin secret`, применить к **All incoming requests**;
   - **Set static**, header name `x-kquiz-origin`, value — секрет.
3. Security → WAF → Rate limiting rules → Create rule (на бесплатном плане одно правило):
   - выражение: URI Path starts with `/api/auth/` **или** URI Path starts with `/oauth/`;
   - 20 запросов за 10 секунд с одного IP → Block на 10 секунд.
4. **Не включай** Bot Fight Mode и «Block AI bots»: Claude ходит к `/mcp` с серверов Anthropic, и Cloudflare примет его за бота.

### 5. Установка на сервер

```sh
ssh root@<IP сервера>
git clone https://github.com/xCAELESTISOx/kquiz.git /opt/kquiz
cd /opt/kquiz/deploy
./setup-server.sh
```

Скрипт ставит Docker, включает firewall (443 только для Cloudflare), запрещает вход по паролю, создаёт `/srv/kquiz/{data,backups,certs}` и ночной бэкап. Если репозиторий приватный, для `git clone` нужен [токен GitHub](https://github.com/settings/personal-access-tokens) с доступом только на чтение к `kquiz`.

Сертификат из шага 3.4:

```sh
nano /srv/kquiz/certs/origin.pem   # вставить Origin Certificate
nano /srv/kquiz/certs/origin.key   # вставить Private key
chmod 600 /srv/kquiz/certs/*
```

Настройки:

```sh
cp .env.example .env
nano .env     # DOMAIN=kquiz.example.com, ORIGIN_SECRET=секрет из шага 4
chmod 600 .env
```

Запуск (первая сборка занимает несколько минут):

```sh
docker compose up -d --build
docker compose ps                         # оба контейнера healthy
docker compose logs api | grep 'setup code'
```

### 6. Первый вход с iPhone

1. Открой `https://kquiz.example.com` в Safari.
2. Введи код настройки из лога и создай passkey (Face ID). Код одноразовый: после первого ключа он больше не работает.
3. Поделиться → **На экран «Домой»**.

### 7. Подключение Claude

claude.ai → Settings → Connectors → **Add custom connector**: имя `KQuiz`, URL `https://kquiz.example.com/mcp`. Claude откроет страницу согласия, подтверди её passkey'ем.

### 8. Автоматический деплой из GitHub Actions

После этого каждый влитый в `main` PR сам попадает на сервер, как только CI зелёный (workflow `.github/workflows/deploy.yml`). Ключ, который лежит в GitHub, умеет только запустить `deploy/update.sh`: ни shell, ни других команд с ним не получить.

На сервере:

```sh
ssh-keygen -t ed25519 -N '' -C github-deploy -f /root/deploy_key
echo "command=\"/opt/kquiz/deploy/update.sh\",restrict $(cat /root/deploy_key.pub)" >> /root/.ssh/authorized_keys
cat /root/deploy_key                 # → секрет DEPLOY_SSH_KEY
ssh-keyscan -t ed25519 localhost | sed "s/^localhost/<IP сервера>/"   # → секрет DEPLOY_KNOWN_HOSTS
rm /root/deploy_key /root/deploy_key.pub
```

В GitHub: репозиторий → Settings → Secrets and variables → Actions:
- Secrets: `DEPLOY_SSH_KEY` и `DEPLOY_KNOWN_HOSTS` (вывод команд выше);
- Variables: `DEPLOY_HOST` = IP сервера.

Пока `DEPLOY_HOST` не задан, workflow пропускается. Запустить деплой вручную: Actions → Deploy → Run workflow.

## Обслуживание

| Задача | Команда на сервере |
|---|---|
| Обновить до свежего `main` | само после шага 8, или вручную `/opt/kquiz/deploy/update.sh` (сначала делает бэкап) |
| Логи | `cd /opt/kquiz/deploy && docker compose logs -f --tail 100` |
| Бэкап вручную | `/opt/kquiz/deploy/backup.sh` |
| Скачать бэкапы к себе | `scp 'root@<IP>:/srv/kquiz/backups/*' .` (с компьютера) |
| Обновить адреса Cloudflare в firewall | `/opt/kquiz/deploy/firewall.sh` (раз в несколько месяцев) |

**Восстановление из бэкапа:**

```sh
cd /opt/kquiz/deploy
docker compose stop api
gunzip -c /srv/kquiz/backups/kquiz-<дата>.db.gz > /srv/kquiz/data/kquiz.db
rm -f /srv/kquiz/data/kquiz.db-wal /srv/kquiz/data/kquiz.db-shm
chown 1000:1000 /srv/kquiz/data/kquiz.db
docker compose start api
```

**Копия бэкапов вне сервера (по желанию).** Бэкапы Hetzner из шага 2 уже хранятся отдельно от диска сервера. Если нужна ещё одна копия, подойдёт Hetzner Storage Box (фиксированная цена): впиши `BACKUP_REMOTE=u123456@u123456.your-storagebox.de:kquiz` в `/etc/kquiz-backup.env` и добавь ключ сервера в Storage Box.

**Оценка произношения.** API к ней пока не обращается, поэтому контейнер `scorer` выключен. Когда понадобится: `docker compose --profile scorer up -d --build` (при первом старте скачает модель, около 1,3 ГБ; памяти 4 ГБ хватает).

## Как устроена защита

- Firewall (`ufw`) пускает на 443 только адреса Cloudflare, порт 80 закрыт, SSH только по ключу.
- Даже если кто-то найдёт IP и обойдёт firewall, API без заголовка `x-kquiz-origin` с секретом отвечает 403 на всё, кроме `/api/health`.
- API и сервис оценки слушают только `127.0.0.1`, снаружи их не видно.
- Caddy режет тела больше 2 МБ, API — больше 1 МБ; лимиты запросов есть и в Cloudflare, и в самом API.
- Контейнеры без root-прав (кроме Caddy, которому оставлено только право занять порт 443), файловая система только для чтения, лимиты памяти, логи ограничены 30 МБ на контейнер, чтобы поток запросов не забил диск.
