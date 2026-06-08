import { createFileRoute } from '@tanstack/react-router';
import { runWatchdog } from '@/lib/telegram/bot';

// External cron service can hit this endpoint every ~10s to drive
// the payment watchdog (check Bakong + expire old QR sessions).
export const Route = createFileRoute('/api/public/telegram/cron')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await runWatchdog();
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      POST: async () => {
        try {
          await runWatchdog();
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});