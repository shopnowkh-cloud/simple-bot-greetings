import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCronRequest } from '../src/lib/telegram/bot';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await handleCronRequest();
  const data = await response.json().catch(() => ({ ok: true }));
  return res.status(response.status).json(data);
}
