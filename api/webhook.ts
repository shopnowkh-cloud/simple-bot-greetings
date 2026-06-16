import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWebhookRequest } from '../src/lib/telegram/bot';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body ?? {};
  console.log('[webhook] update_id:', body?.update_id, '| has msg:', !!body?.message);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v[0] : v);
  }

  const request = new Request('https://placeholder/api/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  try {
    const response = await handleWebhookRequest(request);
    const data = await response.json().catch(() => ({ ok: true }));
    console.log('[webhook] done, status:', response.status);
    return res.status(response.status).json(data);
  } catch (e) {
    console.error('[webhook] unhandled error:', (e as Error).message);
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
