import { createFileRoute } from '@tanstack/react-router';
import { handleWebhookRequest } from '@/lib/telegram/bot';

export const Route = createFileRoute('/api/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhookRequest(request),
    },
  },
});
