import { createFileRoute } from '@tanstack/react-router';
import { handleCronRequest } from '@/lib/telegram/bot';

export const Route = createFileRoute('/api/public/telegram/cron')({
  server: {
    handlers: {
      GET:  async () => { try { return await handleCronRequest(); } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 500 }); } },
      POST: async () => { try { return await handleCronRequest(); } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 500 }); } },
    },
  },
});
