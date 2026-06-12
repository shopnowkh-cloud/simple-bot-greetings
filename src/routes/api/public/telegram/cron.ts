import { createFileRoute } from '@tanstack/react-router';
import { runWatchdog } from '@/lib/telegram/bot';

// Driven by pg_cron every minute. Loops internally for ~55s (every 5s)
// so MD5 payment checks happen near-real-time without depending on
// external cron frequency.
async function runLoop(maxMs = 59_000, intervalMs = 500) {
  const start = Date.now();
  let runs = 0;
  while (Date.now() - start < maxMs) {
    try { await runWatchdog(); } catch (e) {
      console.warn('[cron] watchdog error:', (e as Error).message);
    }
    runs++;
    if (Date.now() - start + intervalMs >= maxMs) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return runs;
}

export const Route = createFileRoute('/api/public/telegram/cron')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const runs = await runLoop();
          return Response.json({ ok: true, runs });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      POST: async () => {
        try {
          const runs = await runLoop();
          return Response.json({ ok: true, runs });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});