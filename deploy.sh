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
echo "🔗 Setting Telegram webhook with secret token..."
WEBHOOK_SECRET=$(python3 -c "
import hashlib, base64, os
key = os.environ.get('TELEGRAM_API_KEY','')
digest = hashlib.sha256(f'telegram-webhook:{key}'.encode()).digest()
print(base64.urlsafe_b64encode(digest).decode().rstrip('='))
")

curl -s "https://api.telegram.org/bot$TELEGRAM_API_KEY/setWebhook" \
  -d "url=https://khmer-telegram-bot.vercel.app/api/webhook" \
  -d "secret_token=$WEBHOOK_SECRET" \
  -d "allowed_updates=[\"message\",\"callback_query\",\"channel_post\"]" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('✅ Webhook OK!' if d.get('ok') else '❌ Webhook failed: ' + str(d))"

echo ""
echo "🔍 Webhook status:"
curl -s "https://api.telegram.org/bot$TELEGRAM_API_KEY/getWebhookInfo" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)['result']
print('  URL:', d.get('url'))
print('  Pending:', d.get('pending_update_count'))
print('  Last error:', d.get('last_error_message','none'))
"
