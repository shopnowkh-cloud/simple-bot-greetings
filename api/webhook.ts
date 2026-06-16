import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWebhookRequest } from '../src/lib/telegram/bot';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v[0] : v);
  }
  const body = JSON.stringify(req.body);
  const request = new Request('https://placeholder/api/webhook', {
    method: 'POST',
    headers,
    body,
  });
  const response = await handleWebhookRequest(request);
  const data = await response.json().catch(() => ({ ok: true }));
  return res.status(response.status).json(data);
}
