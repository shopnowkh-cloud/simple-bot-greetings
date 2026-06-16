import { handleCronRequest } from '../src/lib/telegram/bot';
export default async function handler(req, res) {
    const response = await handleCronRequest();
    const data = await response.json().catch(() => ({ ok: true }));
    return res.status(response.status).json(data);
}
//# sourceMappingURL=cron.js.map