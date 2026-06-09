import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'crypto';
import { handleUpdate } from '@/lib/telegram/bot';
import { markUpdateProcessed, loadDB } from '@/lib/telegram/state';

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
        // ACK Telegram immediately, process in background via CF waitUntil.
        // Telegram considers the update delivered as soon as we return 200,
        // so it can send the next update without waiting for our DB/work.
        const work = (async () => {
          try {
            const [fresh, db] = await Promise.all([
              markUpdateProcessed(update.update_id!),
              loadDB(),
            ]);
            if (!fresh) return;
            await handleUpdate(update as Parameters<typeof handleUpdate>[0], db);
          } catch (e) {
            console.warn('[webhook] bg error:', (e as Error).message);
          }
        })();
        const wu = (globalThis as unknown as {
          __waitUntil?: (p: Promise<unknown>) => void;
        }).__waitUntil;
        if (wu) {
          wu(work);
          return Response.json({ ok: true });
        }
        // Fallback (no waitUntil — e.g. local dev): await before responding.
        await work;
        return Response.json({ ok: true });
      },
    },
  },
});