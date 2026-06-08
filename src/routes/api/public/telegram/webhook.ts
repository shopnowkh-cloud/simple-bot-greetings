import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'crypto';
import { handleUpdate } from '@/lib/telegram/bot';
import { markUpdateProcessed } from '@/lib/telegram/state';

function deriveSecret(apiKey: string): string {
  return createHash('sha256').update(`telegram-webhook:${apiKey}`).digest('base64url');
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute('/api/public/telegram/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
        if (!TELEGRAM_API_KEY) {
          return new Response('Server misconfigured', { status: 500 });
        }
        const expected = deriveSecret(TELEGRAM_API_KEY);
        const actual = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
        if (!safeEqual(actual, expected)) {
          return new Response('Unauthorized', { status: 401 });
        }
        let update: { update_id?: number };
        try {
          update = await request.json();
        } catch {
          return new Response('Bad request', { status: 400 });
        }
        if (typeof update.update_id !== 'number') {
          return Response.json({ ok: true, ignored: true });
        }
        const fresh = await markUpdateProcessed(update.update_id);
        if (!fresh) return Response.json({ ok: true, duplicate: true });
        try {
          await handleUpdate(update as Parameters<typeof handleUpdate>[0]);
        } catch (e) {
          console.warn('[webhook] handleUpdate error:', (e as Error).message);
        }
        return Response.json({ ok: true });
      },
    },
  },
});