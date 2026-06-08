
# Plan: បំលែង `bot.js` (Telegraf long-polling) ទៅ Telegram Webhook

## បរិបទ
ឯកសារ `bot.js` (887 បន្ទាត់) គឺជា bot លក់ "គូប៉ុង" ដែលប្រើ៖
- Telegraf long-polling (មិនអាចរត់នៅ Cloudflare Workers)
- `db.json` ដាក់ក្នុង filesystem (Workers មិនមាន)
- Bakong/Cambo KhPay (បង្កើត QR + check payment)
- Payment watchdog (poll រាល់ 5 វិនាទី)
- Admin panel (បន្ថែម/លុបគូប៉ុង, broadcast, channel forwarding, ...)
- E-GetS channel post → forward verification code ទៅ buyer

## ការផ្លាស់ប្តូរសំខាន់ៗ

### 1. Backend persistence (ជំនួស `db.json`)
បើក **Lovable Cloud** ហើយបង្កើតតារាង `bot_state` ដែលរក្សាទុក state ទាំងមូលជា JSON (រាក់):
```sql
create table public.bot_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
```
រាល់ការផ្លាស់ប្តូរ load/save ទាំងមូលដូច `db.json` — រក្សា logic ដើម។

### 2. បំបាត់ Telegraf — ប្រើ raw Telegram Bot API តាម connector gateway
- Helpers ថ្មី (`tg.ts`): `sendMessage`, `sendPhoto`, `sendDocument`, `deleteMessage`, `answerCallbackQuery`, `editMessageReplyMarkup`
- រាល់ call ឆ្លងកាត់ `https://connector-gateway.lovable.dev/telegram/...` ដោយប្រើ `LOVABLE_API_KEY` + `TELEGRAM_API_KEY`
- បំលែង `Markup.keyboard(...)` ទៅជា raw `reply_markup` JSON (`ReplyKeyboardMarkup`, `InlineKeyboardMarkup`)

### 3. Webhook handler — `src/routes/api/public/telegram/webhook.ts`
- POST receive update → dispatch ទៅ៖
  - `/start` command
  - `callback_query` (buy / qty / cancel / check_payment / dts / dtc / ...)
  - `text` message (admin buttons, user input states, "💵 ទិញគូប៉ុង", ...)
  - `channel_post` (E-GetS forwarding)
- ការពារដោយ `X-Telegram-Bot-Api-Secret-Token` (derive ពី `TELEGRAM_API_KEY`)
- Idempotent តាម `update_id`

### 4. Payment polling (ជំនួស watchdog)
- Workers មិនអាចរត់ `setInterval` ជាប់ៗ ដូច្នេះ៖
  - **On user action**: ពេលអ្នកប្រើចុច "✅ បានបង់ប្រាក់" → check Bakong ភ្លាមៗ (ដូចដើម)
  - **Auto-check endpoint**: `src/routes/api/public/telegram/cron.ts` — រាល់ការ POST នឹង scan ទាំង `payment_pending` sessions, check Bakong, deliver ឬ expire (តាម `PAYMENT_TIMEOUT_SEC=60`)
  - User អាច trigger ដោយខ្លួនឯងតាមរយៈ external cron (uptimerobot, cron-job.org ជាដើម) hit URL រាល់ ~10 វិនាទី
- រាល់ update ដែលចូលមកក៏ trigger watchdog (opportunistic) ដែរ ដូច្នេះ delivery ច្រើនតែឆាប់រហ័ស

### 5. Image / QR / Document
- `QRCode` (npm `qrcode`) — pure JS, ដំណើរការនៅ Workers
- `sendPhoto`/`sendDocument` — បង្កើត `FormData` + `Blob` ហើយ POST ទៅ gateway
- ទាញរូប QR ពី Cambo URL ដោយ `fetch` ដូចដើម

### 6. Secrets ដែលត្រូវការ
- `TELEGRAM_API_KEY` — មាន​ស្រាប់ (Telegram connector)
- `LOVABLE_API_KEY` — មាន​ស្រាប់
- `ADMIN_ID` — បន្ថែម (default `5002402843` ដូចដើម)
- `CAMBO_API_TOKEN` — បន្ថែម (Bakong/Cambo KhPay token)
- `CHANNEL_ID` — optional, storage in DB settings (admin អាចកំណត់តាម UI)
- `TELEGRAM_BOT_TOKEN` — **មិន​ត្រូវការ** (gateway គ្រប់គ្រងជំនួស)

### 7. ការងារដែលអាចមាន limit
- **Watchdog auto-expire**: បើគ្មាន cron hit, session អាច "pending" យូរ — នឹង expire នៅពេល user មកវិញ ឬ cron hit
- **Concurrent delivery lock** (`_delivering` Set): ប្រើ atomic DB update (`UPDATE ... WHERE state = 'payment_pending'`) ជំនួស in-memory Set
- **EGets channel listener**: ដំណើរការដូចដើម ប៉ុន្តែ bot ត្រូវ​ជា admin ក្នុង channel ហើយ Telegram ត្រូវផ្ញើ `channel_post` updates (set `allowed_updates: ["message","callback_query","channel_post"]`)

## Files to create/edit

```
src/lib/telegram/api.ts         # raw Telegram API client (gateway)
src/lib/telegram/keyboards.ts   # keyboard constants
src/lib/telegram/cambo.ts       # KhPay QR + status check
src/lib/telegram/state.ts       # load/save bot_state from Supabase
src/lib/telegram/handlers.ts    # /start, callback, text, channel_post dispatchers
src/lib/telegram/admin.ts       # admin panel logic
src/lib/telegram/payment.ts     # startPayment, deliver, watchdog
src/routes/api/public/telegram/webhook.ts   # POST update handler
src/routes/api/public/telegram/cron.ts      # GET/POST → run watchdog
supabase/migrations/<ts>_bot_state.sql      # bot_state table
```

ខ្ញុំក៏នឹង៖
1. បើក Lovable Cloud + បន្ថែម migration
2. ស្នើ secrets `ADMIN_ID` + `CAMBO_API_TOKEN`
3. ចុះឈ្មោះ webhook URL ជាមួយ Telegram តាម `setWebhook` (allowed_updates ត្រឹមត្រូវ)

## បញ្ជាក់មុនចាប់ផ្តើម
ការងារនេះធំ (~6–8 files ថ្មី, ~1000+ បន្ទាត់ code). តើខ្ញុំចាប់ផ្តើមបានឬនៅ?
