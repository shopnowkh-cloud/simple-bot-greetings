import { createServerFn } from '@tanstack/react-start';

const PUBLIC_URL =
  process.env.PUBLIC_APP_URL || 'https://simple-bot-greetings.lovable.app';

export const ADMIN_APP_BASE = PUBLIC_URL;

interface AuthResult {
  telegramId: number;
  isPrimary: boolean;
}

async function auth(token: string): Promise<AuthResult> {
  if (!token || typeof token !== 'string') throw new Error('Missing token');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin
    .from('admin_tokens')
    .select('telegram_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) throw new Error('Invalid or expired token');
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error('Token expired');
  const tid = Number(data.telegram_id);
  const primary = Number(process.env.ADMIN_ID || '5002402843');
  // Verify still admin (primary or in EXTRA_ADMIN_IDS settings)
  const { data: state } = await supabaseAdmin
    .from('bot_state').select('value').eq('key', 'db').maybeSingle();
  const v = (state?.value ?? {}) as { settings?: Record<string, string> };
  let extras: number[] = [];
  try { extras = JSON.parse(v.settings?.EXTRA_ADMIN_IDS || '[]'); } catch { /* ignore */ }
  if (tid !== primary && !extras.map(Number).includes(tid)) throw new Error('Not an admin');
  return { telegramId: tid, isPrimary: tid === primary };
}

async function loadFullDB() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data } = await supabaseAdmin
    .from('bot_state').select('value').eq('key', 'db').maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  return {
    accounts: (v.accounts as { account_types: Record<string, unknown[]>; prices: Record<string, number> }) ?? { account_types: {}, prices: {} },
    sessions: (v.sessions as Record<string, unknown>) ?? {},
    settings: (v.settings as Record<string, string>) ?? {},
    users: (v.users as Record<string, { first_name: string; last_name: string; username: string; first_seen: string }>) ?? {},
    purchases: (v.purchases as Array<{ user_id: number; account_type: string; quantity: number; total_price: number; accounts: unknown[]; purchased_at: string }>) ?? [],
  };
}

async function saveFullDB(db: unknown) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  await supabaseAdmin
    .from('bot_state')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ key: 'db', value: db as any, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export const getDashboard = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { telegramId, isPrimary } = await auth(data.token);
    const db = await loadFullDB();
    const purchases = db.purchases.slice().reverse();
    const stock = Object.keys(db.accounts.account_types).map((t) => ({
      type: t,
      count: db.accounts.account_types[t].length,
      price: db.accounts.prices[t] ?? 0,
    }));
    const totalRevenue = db.purchases.reduce((s, p) => s + (Number(p.total_price) || 0), 0);
    const totalSold = db.purchases.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const now = Date.now();
    const dayMs = 86_400_000;
    const revToday = db.purchases.filter((p) => now - new Date(p.purchased_at).getTime() < dayMs)
      .reduce((s, p) => s + (Number(p.total_price) || 0), 0);
    const revWeek = db.purchases.filter((p) => now - new Date(p.purchased_at).getTime() < 7 * dayMs)
      .reduce((s, p) => s + (Number(p.total_price) || 0), 0);
    const revMonth = db.purchases.filter((p) => now - new Date(p.purchased_at).getTime() < 30 * dayMs)
      .reduce((s, p) => s + (Number(p.total_price) || 0), 0);
    return {
      me: { telegramId, isPrimary },
      stats: {
        userCount: Object.keys(db.users).length,
        purchaseCount: db.purchases.length,
        totalSold,
        totalRevenue,
        revToday,
        revWeek,
        revMonth,
        stockTotal: stock.reduce((s, x) => s + x.count, 0),
        pendingSessions: Object.values(db.sessions).filter((s) => (s as { state?: string }).state === 'payment_pending').length,
      },
      stock,
      users: Object.entries(db.users).map(([uid, u]) => ({ telegram_id: Number(uid), ...u })),
      purchases: purchases.slice(0, 200),
      settings: {
        CAMBO_API_TOKEN: db.settings.CAMBO_API_TOKEN ?? '',
        TELEGRAM_CHANNEL_ID: db.settings.TELEGRAM_CHANNEL_ID ?? '',
        MAINTENANCE_MODE: db.settings.MAINTENANCE_MODE === 'true',
        EXTRA_ADMIN_IDS: db.settings.EXTRA_ADMIN_IDS ?? '[]',
      },
    };
  });

export const addCoupons = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; type: string; price: number; rawText: string }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    const type = data.type.trim();
    if (!type) throw new Error('Type required');
    const price = Math.round(Number(data.price) * 10000) / 10000;
    if (!isFinite(price) || price < 0) throw new Error('Invalid price');
    const lines = data.rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('No coupons');
    const db = await loadFullDB();
    const existing = db.accounts.prices[type];
    if (existing != null && Math.round(existing * 10000) !== Math.round(price * 10000)) {
      throw new Error(`Type "${type}" already has price $${existing}. Use the same price.`);
    }
    const all = new Set(
      Object.values(db.accounts.account_types).flat().map((a) => {
        const o = a as { code?: string; email?: string; phone?: string };
        return (o.code || o.email || o.phone || '').toLowerCase();
      }).filter(Boolean),
    );
    type Acc = { phone?: string; password?: string; code?: string };
    const accounts: Acc[] = lines.map((l) => {
      if (l.includes('|')) {
        const [ph, pw] = l.split('|').map((s) => s.trim());
        return { phone: ph, password: pw };
      }
      return { code: l };
    });
    const toAdd = accounts.filter((a) => !all.has((a.code || a.phone || '').toLowerCase()));
    if (!db.accounts.account_types[type]) db.accounts.account_types[type] = [];
    (db.accounts.account_types[type] as Acc[]).push(...toAdd);
    db.accounts.prices[type] = price;
    await saveFullDB(db);
    return { added: toAdd.length, duplicates: accounts.length - toAdd.length };
  });

export const deleteCouponType = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; type: string }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    const db = await loadFullDB();
    const count = (db.accounts.account_types[data.type] ?? []).length;
    delete db.accounts.account_types[data.type];
    delete db.accounts.prices[data.type];
    await saveFullDB(db);
    return { ok: true, deleted: count };
  });

export const deleteOneCoupon = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; type: string; index: number }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    const db = await loadFullDB();
    const list = db.accounts.account_types[data.type] as unknown[] | undefined;
    if (!list) throw new Error('Type not found');
    if (data.index < 0 || data.index >= list.length) throw new Error('Index out of range');
    list.splice(data.index, 1);
    await saveFullDB(db);
    return { ok: true, remaining: list.length };
  });

export const listCoupons = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; type: string }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    const db = await loadFullDB();
    const list = (db.accounts.account_types[data.type] as Array<{ code?: string; email?: string; phone?: string; password?: string }> | undefined) ?? [];
    return { items: list };
  });

export const updateSettings = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; cambo?: string; channel?: string; maintenance?: boolean }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    const db = await loadFullDB();
    if (typeof data.cambo === 'string') db.settings.CAMBO_API_TOKEN = data.cambo;
    if (typeof data.channel === 'string') db.settings.TELEGRAM_CHANNEL_ID = data.channel;
    if (typeof data.maintenance === 'boolean') db.settings.MAINTENANCE_MODE = data.maintenance ? 'true' : 'false';
    await saveFullDB(db);
    return { ok: true };
  });

export const manageAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; action: 'add' | 'remove'; telegramId: number }) => d)
  .handler(async ({ data }) => {
    const { isPrimary } = await auth(data.token);
    if (!isPrimary) throw new Error('Only primary admin can manage admins');
    const db = await loadFullDB();
    let extras: number[] = [];
    try { extras = JSON.parse(db.settings.EXTRA_ADMIN_IDS || '[]'); } catch { /* ignore */ }
    const set = new Set(extras.map(Number));
    if (data.action === 'add') set.add(Number(data.telegramId));
    else set.delete(Number(data.telegramId));
    db.settings.EXTRA_ADMIN_IDS = JSON.stringify([...set]);
    await saveFullDB(db);
    return { ok: true, extras: [...set] };
  });

export const broadcastMessage = createServerFn({ method: 'POST' })
  .inputValidator((d: { token: string; text: string }) => d)
  .handler(async ({ data }) => {
    await auth(data.token);
    if (!data.text.trim()) throw new Error('Empty message');
    const db = await loadFullDB();
    const { sendMessage } = await import('@/lib/telegram/api');
    const uids = Object.keys(db.users);
    let sent = 0, failed = 0;
    for (const u of uids) {
      const r = await sendMessage(Number(u), data.text);
      if (r) sent++; else failed++;
      await new Promise((r) => setTimeout(r, 40));
    }
    return { total: uids.length, sent, failed };
  });