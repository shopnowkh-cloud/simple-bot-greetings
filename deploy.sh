#!/bin/bash
set -e

echo "🚀 Deploying to Vercel..."
vercel deploy --prod \
  --token $VERCEL_TOKEN \
  --scope team_X4mwN9ulYKjZSrwORzUJB8rC \
  --yes

echo ""
echo "✅ Deploy done! Bot is live at: https://khmer-telegram-bot.vercel.app"
echo ""
echo "🔗 Setting Telegram webhook..."
curl -s "https://api.telegram.org/bot$TELEGRAM_API_KEY/setWebhook" \
  -d "url=https://khmer-telegram-bot.vercel.app/api/webhook" \
  -d "allowed_updates=[\"message\",\"callback_query\",\"channel_post\"]" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('✅ Webhook OK!' if d.get('ok') else '❌ Webhook failed: ' + str(d))"
