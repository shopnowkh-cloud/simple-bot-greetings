---
name: Python bot stack
description: Project was fully converted from TypeScript/TanStack Start to Python. Stack and entry points for future reference.
---

## Stack
- **Web server:** FastAPI + uvicorn (`main.py`) on port 5000
- **Database:** asyncpg → Replit PostgreSQL via `DATABASE_URL`
- **HTTP client:** httpx (async)
- **QR codes:** qrcode + Pillow
- **Bot logic:** `bot.py` (single file, ~800 lines)

## Entry points
- `main.py` — FastAPI app, imports from `bot.py`
- `bot.py` — all bot logic, DB, Telegram API, KhPay, handlers
- Workflow command: `python main.py`

## Key routes
- `POST /api/public/telegram/webhook` — Telegram webhook
- `GET|POST /api/public/telegram/cron` — payment watchdog cron
- `POST /api/webhook` — alias for webhook
- `GET /` — status page

## Required secrets
- `TELEGRAM_API_KEY` — bot token from @BotFather
- `ADMIN_ID` — primary admin Telegram user ID
- `DATABASE_URL` — auto-set by Replit PostgreSQL

**Why:** Original project was TypeScript/TanStack Start (Vercel-targeted). Migrated to Python per user request. All logic preserved 1:1.
