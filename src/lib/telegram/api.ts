// Raw Telegram Bot API client — direct calls to api.telegram.org
const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_API_KEY;
  if (!token) throw new Error('TELEGRAM_API_KEY is not configured');
  return token;
}

function toArrayBuffer(b: Buffer | Uint8Array): ArrayBuffer {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  const out = new ArrayBuffer(u8.byteLength);
  new Uint8Array(out).set(u8);
  return out;
}

async function call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  try {
    const token = getBotToken();
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  | { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string } }>> }
  | { keyboard: Array<Array<string | { text: string; web_app?: { url: string } }>>; resize_keyboard?: boolean; is_persistent?: boolean; one_time_keyboard?: boolean }
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

export function editMessageText(chat_id: number | string, message_id: number, text: string, reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string } }>> }) {
  return call<TgMessage>('editMessageText', {
    chat_id,
    message_id,
    text,
    parse_mode: 'HTML',
    ...(reply_markup ? { reply_markup } : {}),
  });
}

export function answerCallbackQuery(callback_query_id: string, text?: string, show_alert = false) {
  return call('answerCallbackQuery', { callback_query_id, ...(text ? { text } : {}), show_alert });
}

export async function sendPhoto(chat_id: number | string, photo: Buffer | Uint8Array, opts: { caption?: string; reply_markup?: ReplyMarkup } = {}): Promise<TgMessage | null> {
  try {
    const token = getBotToken();
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('parse_mode', 'HTML');
    if (opts.caption) form.append('caption', opts.caption);
    if (opts.reply_markup) form.append('reply_markup', JSON.stringify(opts.reply_markup));
    form.append('photo', new Blob([toArrayBuffer(photo)], { type: 'image/png' }), 'qr.png');
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendPhoto`, { method: 'POST', body: form });
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
    const token = getBotToken();
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('parse_mode', 'HTML');
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([toArrayBuffer(buffer)], { type: 'text/plain' }), filename);
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, { method: 'POST', body: form });
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
