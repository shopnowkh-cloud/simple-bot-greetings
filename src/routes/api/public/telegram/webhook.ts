import { createFileRoute } from '@tanstack/react-router';

async function sendMessage(chatId: number, text: string) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    throw new Error('Missing Telegram credentials');
  }
  const res = await fetch('https://connector-gateway.lovable.dev/telegram/sendMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendMessage failed [${res.status}]: ${body}`);
  }
}

export const Route = createFileRoute('/api/public/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const update = await request.json();
        const message = update.message;
        const text: string | undefined = message?.text;
        const chatId: number | undefined = message?.chat?.id;

        if (chatId && text && text.startsWith('/start')) {
          const username =
            message.from?.username ||
            message.from?.first_name ||
            'មិត្ត';
          await sendMessage(chatId, `សួស្តី ${username}`);
        }

        return Response.json({ ok: true });
      },
    },
  },
});