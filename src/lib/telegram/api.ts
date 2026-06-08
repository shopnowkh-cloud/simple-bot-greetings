// Raw Telegram Bot API client via Lovable connector gateway
const GATEWAY = 'https://connector-gateway.lovable.dev/telegram';

function headers(extra: Record<string, string> = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
  if (!TELEGRAM_API_KEY) throw new Error('TELEGRAM_API_KEY is not configured');
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': TELEGRAM_API_KEY,
    ...extra,
  };
}

async function call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${GATEWAY}/${method}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as { ok?: boolean }).ok === false) {
      console.warn(`[tg] ${method} failed [${res.status}]:`, JSON.stringify(data).slice(0, 300));
      return null;
    }
    return ((data as { result?: T }).result ?? null) as T | null;
  } catch (e) {
    console.warn(`[tg] ${method} error:`, (e as Error).message);
    return null;
  }
}

export type ReplyMarkup =
  | { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
  | { keyboard: string[][]; resize_keyboard?: boolean; is_persistent?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true }
  | undefined;

export interface TgMessage {
  message_id: number;
  chat?: { id: number };
  from?: { id: number };
}

export function sendMessage(chat_id: number | string, text: string, reply_markup?: ReplyMarkup, extra: Record<string, unknown> = {}) {
  return call<TgMessage>('sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
    ...extra,
  });
}

export function deleteMessage(chat_id: number | string, message_id: number) {
  return call('deleteMessage', { chat_id, message_id });
}

export function answerCallbackQuery(callback_query_id: string, text?: string, show_alert = false) {
  return call('answerCallbackQuery', { callback_query_id, ...(text ? { text } : {}), show_alert });
}

export async function sendPhoto(chat_id: number | string, photo: Buffer | Uint8Array, opts: { caption?: string; reply_markup?: ReplyMarkup } = {}): Promise<TgMessage | null> {
  try {
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('parse_mode', 'HTML');
    if (opts.caption) form.append('caption', opts.caption);
    if (opts.reply_markup) form.append('reply_markup', JSON.stringify(opts.reply_markup));
    const u8 = photo instanceof Uint8Array ? photo : new Uint8Array(photo);
    form.append('photo', new Blob([u8], { type: 'image/png' }), 'qr.png');
    const res = await fetch(`${GATEWAY}/sendPhoto`, { method: 'POST', headers: headers(), body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as { ok?: boolean }).ok === false) {
      console.warn('[tg] sendPhoto failed:', JSON.stringify(data).slice(0, 300));
      return null;
    }
    return (data as { result?: TgMessage }).result ?? null;
  } catch (e) {
    console.warn('[tg] sendPhoto error:', (e as Error).message);
    return null;
  }
}

export async function sendDocument(chat_id: number | string, buffer: Buffer | Uint8Array, filename: string, caption?: string): Promise<TgMessage | null> {
  try {
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('parse_mode', 'HTML');
    if (caption) form.append('caption', caption);
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    form.append('document', new Blob([u8], { type: 'text/plain' }), filename);
    const res = await fetch(`${GATEWAY}/sendDocument`, { method: 'POST', headers: headers(), body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as { ok?: boolean }).ok === false) {
      console.warn('[tg] sendDocument failed:', JSON.stringify(data).slice(0, 300));
      return null;
    }
    return (data as { result?: TgMessage }).result ?? null;
  } catch (e) {
    console.warn('[tg] sendDocument error:', (e as Error).message);
    return null;
  }
}