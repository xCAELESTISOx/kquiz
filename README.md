# KQuiz

Личное приложение для изучения корейского: карточки с интервальным повторением, добавление карточек из Claude через MCP и тренировка произношения с разбором по звукам. Тёмная тема, PWA для iPhone, один пользователь.

План, архитектура и этапы: [docs/PLAN.md](docs/PLAN.md).

## Структура

| Путь | Что это |
|---|---|
| `apps/web` | PWA: React + Vite + TypeScript |
| `apps/api` | Бэкенд: Hono на Node, FSRS, позже SQLite, вход по passkey и MCP для Claude |
| `services/scorer` | Внутренний Python-сервис оценки произношения |

## Запуск

Нужны Node 22+ и pnpm 10.

```sh
pnpm install
pnpm dev        # api на :8787, web на :5173 с прокси /api
pnpm test
pnpm build
```

Сервис оценки запускается отдельно, см. [services/scorer/README.md](services/scorer/README.md).
