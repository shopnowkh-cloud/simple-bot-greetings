import QRCode from 'qrcode';
import { createHash, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
// ============= Database =============
const _pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function query(text, params = []) {
    const client = await _pool.connect();
    try {
        const result = await client.query(text, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    }
    finally {
        client.release();
    }
}
// ============= Telegram API (api.ts) =============
const TELEGRAM_API_BASE = 'https://api.telegram.org';
function getBotToken() {
    const token = process.env.TELEGRAM_API_KEY;
    if (!token)
        throw new Error('TELEGRAM_API_KEY is not configured');
    return token;
}
function toArrayBuffer(b) {
    const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
    const out = new ArrayBuffer(u8.byteLength);
    new Uint8Array(out).set(u8);
    return out;
}
async function call(method, payload) {
    try {
        const token = getBotToken();
        const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
            console.warn(`[tg] ${method} failed [${res.status}]:`, JSON.stringify(data).slice(0, 300));
            return null;
        }
        return (data.result ?? null);
    }
    catch (e) {
        console.warn(`[tg] ${method} error:`, e.message);
        return null;
    }
}
function sendMessage(chat_id, text, reply_markup, extra = {}) {
    return call('sendMessage', {
        chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(reply_markup ? { reply_markup } : {}),
        ...extra,
    });
}
function deleteMessage(chat_id, message_id) {
    return call('deleteMessage', { chat_id, message_id });
}
function editMessageText(chat_id, message_id, text, reply_markup) {
    return call('editMessageText', {
        chat_id,
        message_id,
        text,
        parse_mode: 'HTML',
        ...(reply_markup ? { reply_markup } : {}),
    });
}
function answerCallbackQuery(callback_query_id, text, show_alert = false) {
    return call('answerCallbackQuery', { callback_query_id, ...(text ? { text } : {}), show_alert });
}
async function sendPhoto(chat_id, photo, opts = {}) {
    try {
        const token = getBotToken();
        const form = new FormData();
        form.append('chat_id', String(chat_id));
        form.append('parse_mode', 'HTML');
        if (opts.caption)
            form.append('caption', opts.caption);
        if (opts.reply_markup)
            form.append('reply_markup', JSON.stringify(opts.reply_markup));
        form.append('photo', new Blob([toArrayBuffer(photo)], { type: 'image/png' }), 'qr.png');
        const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendPhoto`, { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
            console.warn('[tg] sendPhoto failed:', JSON.stringify(data).slice(0, 300));
            return null;
        }
        return data.result ?? null;
    }
    catch (e) {
        console.warn('[tg] sendPhoto error:', e.message);
        return null;
    }
}
async function sendDocument(chat_id, buffer, filename, caption) {
    try {
        const token = getBotToken();
        const form = new FormData();
        form.append('chat_id', String(chat_id));
        form.append('parse_mode', 'HTML');
        if (caption)
            form.append('caption', caption);
        form.append('document', new Blob([toArrayBuffer(buffer)], { type: 'text/plain' }), filename);
        const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
            console.warn('[tg] sendDocument failed:', JSON.stringify(data).slice(0, 300));
            return null;
        }
        return data.result ?? null;
    }
    catch (e) {
        console.warn('[tg] sendDocument error:', e.message);
        return null;
    }
}
// ============= Constants (constants.ts) =============
const BTN_ADD_ACCOUNT = '➕ បន្ថែម គូប៉ុង';
const BTN_DELETE_TYPE = '🗑 លុបប្រភេទ';
const BTN_STOCK = '📦 ស្តុក គូប៉ុង';
const BTN_USERS = '👥 អ្នកប្រើប្រាស់';
const BTN_BUYERS = '📋 របាយការណ៍ទិញ';
const BTN_KHPAY = '💰 KhPay API';
const BTN_CHANNEL = '📢 Channel ID';
const BTN_ADMINS = '👑 គ្រប់គ្រង Admin';
const BTN_MAINTENANCE = '🛠 Maintenance Mode';
const BTN_BROADCAST = '📢 ផ្សាយព័ត៌មាន';
const BTN_BACK_SETTINGS = '⬅️';
const BTN_KHPAY_KEY_EDIT = '✏️ ប្តូរ KhPay API Key';
const BTN_KHPAY_INFO = '📊 ព័ត៌មាន KhPay';
const BTN_CHANNEL_EDIT = '✏️ ប្តូរ Channel ID';
const BTN_CHANNEL_CLEAR = '🗑 លុប Channel ID';
const BTN_ADMIN_ADD = '➕ បន្ថែម Admin';
const BTN_ADMIN_REMOVE = '➖ ដក Admin';
const BTN_MAINT_ON = '🔴 បិទ Bot';
const BTN_MAINT_OFF = '🟢 បើក Bot';
const BTN_CANCEL_INPUT = '🚫 បោះបង់';
const BTN_DELETE_CONFIRM = '✅ បញ្ជាក់លុប';
const BTN_DELETE_CANCEL = '🚫 បោះបង់ការលុប';
const BTN_BROADCAST_CONFIRM = '✅ បញ្ជាក់ផ្សាយ';
const BTN_BROADCAST_CANCEL = '🚫 បោះបង់ការផ្សាយ';
const ADMIN_BUTTON_LABELS = new Set([
    BTN_ADD_ACCOUNT, BTN_DELETE_TYPE, BTN_STOCK, BTN_USERS, BTN_BUYERS,
    BTN_KHPAY, BTN_CHANNEL, BTN_ADMINS, BTN_MAINTENANCE, BTN_BROADCAST,
    BTN_BACK_SETTINGS, BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO,
    BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR, BTN_ADMIN_ADD, BTN_ADMIN_REMOVE,
    BTN_MAINT_ON, BTN_MAINT_OFF, BTN_CANCEL_INPUT,
    BTN_DELETE_CONFIRM, BTN_DELETE_CANCEL, BTN_BROADCAST_CONFIRM, BTN_BROADCAST_CANCEL,
]);
const kb = (rows) => ({ keyboard: rows, resize_keyboard: true, is_persistent: true });
const MAIN_KB = kb([['💵 ទិញគូប៉ុង']]);
const ADMIN_SETTINGS_KB = kb([
    [BTN_ADD_ACCOUNT, BTN_DELETE_TYPE],
    [BTN_STOCK, BTN_BUYERS],
    [BTN_USERS, BTN_KHPAY],
    [BTN_CHANNEL, BTN_ADMINS],
    [BTN_BROADCAST, BTN_MAINTENANCE],
]);
const CANCEL_INPUT_KB = kb([[BTN_CANCEL_INPUT]]);
const ADD_ACCOUNT_KB = kb([[BTN_BACK_SETTINGS]]);
const BACK_SETTINGS_KB = kb([[BTN_BACK_SETTINGS]]);
const KHPAY_SUBMENU_KB = kb([[BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO], [BTN_BACK_SETTINGS]]);
const CHANNEL_SUBMENU_KB = kb([[BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR], [BTN_BACK_SETTINGS]]);
const ADMINS_SUBMENU_KB = kb([[BTN_ADMIN_ADD, BTN_ADMIN_REMOVE], [BTN_BACK_SETTINGS]]);
const MAINTENANCE_SUBMENU_KB = kb([[BTN_MAINT_ON, BTN_MAINT_OFF], [BTN_BACK_SETTINGS]]);
const BROADCAST_CONFIRM_KB = kb([[BTN_BROADCAST_CONFIRM], [BTN_BROADCAST_CANCEL]]);
const REMOVE_KB = { remove_keyboard: true };
const CHECK_PAYMENT_INLINE = {
    inline_keyboard: [[
            { text: '🚫 បោះបង់', callback_data: 'cancel_purchase' },
            { text: '✅ បានបង់ប្រាក់', callback_data: 'check_payment' },
        ]],
};
const PAYMENT_TIMEOUT_SEC = 60;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KH_TZ = 'Asia/Phnom_Penh';
const nowKH = () => new Date().toLocaleString('sv-SE', { timeZone: KH_TZ }).replace('T', ' ') + ' +07';
const nowKHFile = () => new Date().toLocaleString('sv-SE', { timeZone: KH_TZ }).replace(/[-: ]/g, '').slice(0, 14);
const fmtKH = (iso) => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: KH_TZ }).replace('T', ' ') + ' +07' : '—';
const shortLabel = (t, n = 36) => {
    const c = t.trim();
    return c.length <= n ? c : c.slice(0, n - 1) + '…';
};
const typeCallbackId = (at) => createHash('sha1').update(at).digest('hex').slice(0, 12);
function formatAccount(acc) {
    if (typeof acc === 'string')
        return acc;
    const a = acc;
    if (a.email)
        return a.email;
    if (a.phone)
        return `${a.phone} | ${a.password || ''}`;
    if (a.code)
        return a.code;
    return JSON.stringify(acc);
}
// ============= Cambo/KhPay (cambo.ts) =============
const CAMBO_BASE = 'https://bakong.cambo-kh.com/api/v2';
async function camboRequest(token, params, opts = {}) {
    const qp = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_token: token });
    const url = `${CAMBO_BASE}/?${qp.toString()}`;
    const timeoutMs = opts.timeoutMs ?? 25000;
    const retries = opts.retries ?? 2;
    let lastErr = '';
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            const text = await res.text();
            try {
                return JSON.parse(text);
            }
            catch {
                return { success: false, error: text };
            }
        }
        catch (e) {
            lastErr = e.message;
            if (i < retries)
                await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
    return { success: false, error: lastErr || 'request failed' };
}
async function generatePlainQR(qr_string) {
    return QRCode.toBuffer(qr_string, {
        errorCorrectionLevel: 'M',
        width: 400,
        margin: 3,
        color: { dark: '#000000', light: '#ffffff' },
    });
}
async function createKhpayPayment(token, amount) {
    try {
        const res = await camboRequest(token, { type: 'generate_qr', amount }, { timeoutMs: 25000, retries: 2 });
        if (res.status !== 'success' || !res.data) {
            return { imgBuffer: null, transaction_id: null, error: res.message || res.error || 'API error' };
        }
        const d = res.data;
        const md5 = d.md5 || null;
        const qr_string = d.qr || '';
        const imgUrl = d.Url_qr_code || null;
        let imgBuffer = null;
        if (qr_string) {
            try {
                imgBuffer = await generatePlainQR(qr_string);
            }
            catch {
                imgBuffer = null;
            }
        }
        if (!imgBuffer && imgUrl) {
            try {
                const r = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
                if (r.ok)
                    imgBuffer = Buffer.from(await r.arrayBuffer());
            }
            catch { /* ignore */ }
        }
        if (!imgBuffer)
            return { imgBuffer: null, transaction_id: null, error: 'No QR data returned' };
        return { imgBuffer, transaction_id: md5, md5, expires_in: 180, error: null };
    }
    catch (e) {
        return { imgBuffer: null, transaction_id: null, error: e.message };
    }
}
async function checkKhpayStatus(token, transaction_id, md5) {
    try {
        const checkMd5 = md5 || transaction_id;
        const data = await camboRequest(token, { type: 'check_md5', md5: checkMd5 }, { timeoutMs: 15000, retries: 1 });
        const status = String(data?.status ?? '').toLowerCase();
        const paid = status === 'paid' || status === 'success' || status === 'completed';
        return { paid, status: status || 'pending', data };
    }
    catch (e) {
        console.warn('[Cambo] check error:', e.message);
        return { paid: false, status: 'error', data: null };
    }
}
const EMPTY = {
    accounts: { account_types: {}, prices: {} },
    sessions: {},
    settings: {},
    users: {},
    purchases: [],
};
export async function loadDB() {
    try {
        const result = await query("SELECT value FROM bot_state WHERE key = 'db' LIMIT 1");
        if (!result.rows.length)
            return structuredClone(EMPTY);
        const v = (result.rows[0].value ?? {});
        return {
            accounts: {
                account_types: v.accounts?.account_types ?? {},
                prices: v.accounts?.prices ?? {},
            },
            sessions: v.sessions ?? {},
            settings: v.settings ?? {},
            users: v.users ?? {},
            purchases: v.purchases ?? [],
        };
    }
    catch (e) {
        console.warn('[state] loadDB error:', e.message);
        return structuredClone(EMPTY);
    }
}
export async function saveDB(db) {
    try {
        await query(`INSERT INTO bot_state (key, value, updated_at)
       VALUES ('db', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(db)]);
    }
    catch (e) {
        console.warn('[state] saveDB error:', e.message);
    }
}
export async function markUpdateProcessed(updateId) {
    try {
        await query('INSERT INTO telegram_updates (update_id) VALUES ($1)', [updateId]);
        return true;
    }
    catch {
        return false;
    }
}
function loadCtx(db) {
    const ADMIN_ID = Number(process.env.ADMIN_ID || '5002402843');
    const ea = db.settings.EXTRA_ADMIN_IDS;
    let EXTRA = new Set();
    if (ea) {
        try {
            EXTRA = new Set(JSON.parse(ea).map(Number));
        }
        catch { /* ignore */ }
    }
    return {
        db,
        ADMIN_ID,
        EXTRA_ADMIN_IDS: EXTRA,
        CHANNEL_ID: db.settings.TELEGRAM_CHANNEL_ID ?? '',
        CAMBO_API_TOKEN: db.settings.CAMBO_API_TOKEN ?? process.env.CAMBO_API_TOKEN ?? '',
        MAINTENANCE_MODE: db.settings.MAINTENANCE_MODE === 'true',
    };
}
const isAdmin = (ctx, uid) => Number(uid) === ctx.ADMIN_ID || ctx.EXTRA_ADMIN_IDS.has(Number(uid));
async function buildAdminKb(_uid) {
    return {
        keyboard: [
            [BTN_ADD_ACCOUNT, BTN_DELETE_TYPE],
            [BTN_STOCK, BTN_BUYERS],
            [BTN_USERS, BTN_KHPAY],
            [BTN_CHANNEL, BTN_ADMINS],
            [BTN_BROADCAST, BTN_MAINTENANCE],
        ],
        resize_keyboard: true,
        is_persistent: true,
    };
}
async function mainKb(ctx, uid) {
    return isAdmin(ctx, uid) ? await buildAdminKb(uid) : REMOVE_KB;
}
const typeFromCbId = (ctx, cid) => Object.keys(ctx.db.accounts.account_types).find((t) => typeCallbackId(t) === cid) ?? null;
// ============= Common UI =============
async function notifyAdminNewUser(ctx, user) {
    const uid = user.id;
    if (uid === ctx.ADMIN_ID || ctx.db.users[String(uid)])
        return;
    ctx.db.users[String(uid)] = {
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        username: user.username || '',
        first_seen: new Date().toISOString(),
    };
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A';
    const uname = user.username ? `@${user.username}` : '—';
    sendMessage(ctx.ADMIN_ID, `🆕 <b>អ្នកប្រើប្រាស់ថ្មី!</b>\n\n👤 ឈ្មោះ: ${esc(full)}\n🔖 Username: ${esc(uname)}\n🪪 ID: <code>${uid}</code>`).catch(() => { });
}
async function showAccountSelection(ctx, chatId) {
    const available = Object.entries(ctx.db.accounts.account_types)
        .filter(([, v]) => v.length > 0)
        .map(([at, v]) => ({ at, count: v.length }));
    if (!available.length) {
        await sendMessage(chatId, '<i>សូមអភ័យទោស អស់ពីស្តុក 🪤</i>');
        return;
    }
    const rows = available.map(({ at, count }) => [
        { text: `${at} – មានក្នុងស្តុក ${count}`, callback_data: `buy:${typeCallbackId(at)}` },
    ]);
    await sendMessage(chatId, '<b>សូមជ្រើសរើសគូប៉ុងដើម្បីទិញ៖</b>', { inline_keyboard: rows });
}
async function sendAdminSettingsMenu(_ctx, chatId) {
    await sendMessage(chatId, '<b>⚙️ ការកំណត់ Admin</b>\n\nសូមជ្រើសរើសប្រតិបត្តិការខាងក្រោម៖', ADMIN_SETTINGS_KB);
}
// ============= Payment =============
async function startPaymentForSession(ctx, chatId, userId, session, cbId) {
    const at = session.account_type;
    const qty = session.quantity;
    const pool = ctx.db.accounts.account_types[at] ?? [];
    if (pool.length < qty) {
        if (cbId)
            await answerCallbackQuery(cbId, `សូមអភ័យទោស! មានត្រឹមតែ ${pool.length} គូប៉ុង នៅក្នុងស្តុក`, true);
        delete ctx.db.sessions[String(userId)];
        return false;
    }
    session.reserved_accounts = pool.slice(0, qty);
    ctx.db.accounts.account_types[at] = pool.slice(qty);
    session.available_count = ctx.db.accounts.account_types[at].length;
    if (cbId)
        await answerCallbackQuery(cbId, 'កំពុងបង្កើត QR...');
    session.state = 'payment_pending';
    const { imgBuffer, transaction_id, md5, error } = await createKhpayPayment(ctx.CAMBO_API_TOKEN, session.total_price);
    if (!imgBuffer || !transaction_id) {
        if (isAdmin(ctx, userId)) {
            await sendMessage(chatId, `❌ <b>QR បរាជ័យ (Admin Debug):</b>\n<code>${esc(String(error))}</code>`);
        }
        else {
            await sendMessage(chatId, '❌ <b>មានបញ្ហាក្នុងការបង្កើត QR Code</b>\n\nសូមព្យាយាមម្ដងទៀត។');
            await sendMessage(ctx.ADMIN_ID, `⚠️ QR Error (user ${userId}): <code>${esc(String(error))}</code>`);
        }
        delete ctx.db.sessions[String(userId)];
        return false;
    }
    session.transaction_id = transaction_id;
    session.md5 = md5 ?? null;
    session.qr_sent_at = Date.now();
    const photo = await sendPhoto(chatId, imgBuffer, { reply_markup: CHECK_PAYMENT_INLINE });
    if (photo) {
        session.photo_message_id = photo.message_id;
        session.qr_message_id = photo.message_id;
    }
    ctx.db.sessions[String(userId)] = session;
    console.log(`[INFO] KhPay QR sent to user ${userId}: $${session.total_price}, TxnID: ${transaction_id}`);
    return true;
}
async function deliverAccounts(ctx, chatId, userId, session, paymentData = null) {
    const at = session.account_type;
    const qty = session.quantity;
    for (const k of ['photo_message_id', 'qr_message_id']) {
        const mid = session[k];
        if (mid)
            deleteMessage(chatId, mid).catch(() => { });
    }
    let delivered = null;
    const reserved = session.reserved_accounts ?? [];
    if (reserved.length >= qty) {
        delivered = reserved.slice(0, qty);
    }
    else if ((ctx.db.accounts.account_types[at] ?? []).length >= qty) {
        const pool = ctx.db.accounts.account_types[at];
        delivered = pool.slice(0, qty);
        ctx.db.accounts.account_types[at] = pool.slice(qty);
    }
    session.reserved_accounts = [];
    delete ctx.db.sessions[String(userId)];
    if (!delivered) {
        await sendMessage(chatId, `❌ <b>មានបញ្ហា!</b>\n\nគ្មាន គូប៉ុង ប្រភេទ ${esc(at)} ក្នុងស្តុក។`);
        return;
    }
    ctx.db.purchases.push({
        user_id: userId,
        account_type: at,
        quantity: qty,
        total_price: session.total_price,
        accounts: delivered,
        purchased_at: new Date().toISOString(),
    });
    for (let i = 0; i < delivered.length; i++) {
        const acc = delivered[i];
        const isLast = i === delivered.length - 1;
        const msg = `🎉 <b>ការទិញបានបញ្ជាក់ដោយជោគជ័យ</b>\n\nគូប៉ុងរបស់អ្នក៖ 👇\n\n<code>${esc(formatAccount(acc))}</code>\n\n<i>សូមអរគុណសម្រាប់ការទិញ 🙏</i>`;
        await sendMessage(chatId, msg, isLast ? await mainKb(ctx, userId) : undefined);
    }
    try {
        const pd = paymentData || {};
        const fromAcc = pd.fromAccountId || pd.hash || 'N/A';
        const memo = pd.memo || 'គ្មាន';
        const ref = pd.externalRef || pd.transactionId || pd.md5 || 'N/A';
        const adminMsg = '🎉 <b>ទទួលបានការបង់ប្រាក់ជោគជ័យ</b>\n' +
            '━━━━━━━━━━━━━━━━━━━\n' +
            `🆔 <b>អ្នកទិញ(ID):</b> ${userId}\n` +
            `📦 <b>ប្រភេទ:</b> ${esc(at)} × ${qty}\n` +
            `💵 <b>ទឹកប្រាក់:</b> $${session.total_price}\n` +
            `👤 <b>ពីធនាគារ:</b> <code>${esc(fromAcc)}</code>\n` +
            `📝 <b>ចំណាំ:</b> ${esc(memo)}\n` +
            `🧾 <b>លេខយោង:</b> <code>${esc(ref)}</code>\n` +
            `⏰ <b>ម៉ោង:</b> ${nowKH()}`;
        sendMessage(ctx.ADMIN_ID, adminMsg).catch(() => { });
        if (ctx.CHANNEL_ID && String(ctx.CHANNEL_ID) !== String(ctx.ADMIN_ID)) {
            sendMessage(ctx.CHANNEL_ID, adminMsg).catch(() => { });
        }
    }
    catch (e) {
        console.warn('[WARN] admin payment notify:', e.message);
    }
    console.log(`[INFO] Delivered ${qty}× ${at} to user ${userId}`);
}
export async function runWatchdog(preCtx) {
    let ctx;
    if (preCtx) {
        ctx = preCtx;
    }
    else {
        const db = await loadDB();
        ctx = loadCtx(db);
    }
    const db = ctx.db;
    const pending = Object.entries(db.sessions).filter(([, s]) => s.state === 'payment_pending');
    if (!pending.length)
        return;
    let dirty = false;
    for (const [uidStr, sess] of pending) {
        const userId = Number(uidStr);
        const elapsed = Date.now() - (sess.qr_sent_at || 0);
        if (elapsed >= PAYMENT_TIMEOUT_SEC * 1000) {
            const at = sess.account_type;
            const reserved = sess.reserved_accounts ?? [];
            if (reserved.length && at) {
                db.accounts.account_types[at] = [...reserved, ...(db.accounts.account_types[at] ?? [])];
            }
            delete db.sessions[uidStr];
            dirty = true;
            if (sess.photo_message_id)
                deleteMessage(userId, sess.photo_message_id).catch(() => { });
            await sendMessage(userId, '⌛ <b>QR Code បានផុតកំណត់</b>\n\nសូមបង្កើតការទិញម្ដងទៀត។').catch(() => { });
            await showAccountSelection(ctx, userId).catch(() => { });
            continue;
        }
        if (!sess.transaction_id)
            continue;
        try {
            const { paid, data: payData } = await checkKhpayStatus(ctx.CAMBO_API_TOKEN, sess.transaction_id, sess.md5 ?? null);
            if (!paid)
                continue;
            const cur = db.sessions[uidStr];
            if (!cur || cur.transaction_id !== sess.transaction_id || cur.state !== 'payment_pending')
                continue;
            cur.state = 'delivering';
            dirty = true;
            await deliverAccounts(ctx, userId, userId, cur, payData);
        }
        catch (e) {
            console.warn(`[Watchdog] check error ${sess.transaction_id}:`, e.message);
        }
    }
    if (dirty || pending.length)
        await saveDB(db);
}
// ============= Admin export helpers =============
async function exportStock(ctx, chatId) {
    const types = ctx.db.accounts.account_types;
    const prices = ctx.db.accounts.prices;
    const names = Object.keys(types).sort();
    if (!names.length) {
        await sendMessage(chatId, '📦 មិនមានប្រភេទ គូប៉ុង ឡើយទេ។', ADMIN_SETTINGS_KB);
        return;
    }
    const totalAvail = names.reduce((s, t) => s + (types[t] || []).length, 0);
    const W = 60;
    const lines = [
        '='.repeat(W),
        '  ស្តុក គូប៉ុង / COUPON STOCK'.padEnd(W),
        `  ${nowKH()}`.padEnd(W),
        `  ប្រភេទ: ${names.length}  |  សរុប: ${totalAvail} គូប៉ុង`.padEnd(W),
        '='.repeat(W), '',
    ];
    for (const t of names) {
        const pool = types[t] || [];
        const price = prices[t] ?? 0;
        lines.push(`[ ${t} ]  💰 $${price}  📦 ${pool.length} គូប៉ុង`, '─'.repeat(W));
        if (pool.length)
            pool.forEach((acc, i) => lines.push(`  ${i + 1}. ${formatAccount(acc)}`));
        else
            lines.push('  (គ្មានក្នុងស្តុក)');
        lines.push('');
    }
    lines.push('='.repeat(W));
    const buf = Buffer.from(lines.join('\n'), 'utf8');
    await sendDocument(chatId, buf, `stock_${nowKHFile()}.txt`, `📦 <b>ស្តុក គូប៉ុង</b> — ${names.length} ប្រភេទ, ${totalAvail} នៅសល់`);
    await sendAdminSettingsMenu(ctx, chatId);
}
async function exportBuyers(ctx, chatId) {
    if (!ctx.db.purchases.length) {
        await sendMessage(chatId, 'មិនមានទិន្នន័យ​ទិញ​នៅឡើយ​ទេ។', ADMIN_SETTINGS_KB);
        return;
    }
    const grouped = {};
    for (const p of ctx.db.purchases) {
        const uid = String(p.user_id);
        if (!grouped[uid]) {
            const u = ctx.db.users[uid] || { first_name: '', last_name: '', username: '', first_seen: '' };
            grouped[uid] = { first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '', purchases: [] };
        }
        grouped[uid].purchases.push(p);
    }
    const W = 60;
    const lines = ['='.repeat(W), '  BUYERS REPORT'.padEnd(W), `  ${nowKH()}`.padEnd(W), '='.repeat(W), `  Total buyers : ${Object.keys(grouped).length}`];
    for (const [uid, info] of Object.entries(grouped)) {
        const fn = [info.first_name, info.last_name].filter(Boolean).join(' ') || '(no name)';
        const un = info.username ? `@${info.username}` : '—';
        lines.push('', '─'.repeat(W), `  ID       : ${uid}`, `  Name     : ${fn}`, `  Username : ${un}`, `  Purchases: ${info.purchases.length}`, '─'.repeat(W));
        info.purchases.forEach((p, i) => {
            lines.push(`  [${i + 1}] ${p.account_type}`, `      Qty   : ${p.quantity}`, `      Price : $${p.total_price}`, `      Date  : ${fmtKH(p.purchased_at)}`, '      Accounts:');
            (p.accounts || []).forEach((a) => lines.push(`        • ${formatAccount(a)}`));
            if (!(p.accounts || []).length)
                lines.push('        (none)');
        });
    }
    lines.push('', '='.repeat(W), '='.repeat(W));
    const buf = Buffer.from(lines.join('\n'), 'utf8');
    await sendDocument(chatId, buf, `buyers_${nowKHFile()}.txt`, `📋 របាយការណ៍ទិញ — ${Object.keys(grouped).length} អ្នក​ទិញ`);
    await sendAdminSettingsMenu(ctx, chatId);
}
async function showUsersList(ctx, chatId) {
    const rows = Object.entries(ctx.db.users);
    if (!rows.length) {
        await sendMessage(chatId, '📭 <b>មិនទាន់មានអ្នកប្រើប្រាស់ទេ។</b>', BACK_SETTINGS_KB);
        return;
    }
    const lines = [`👥 អ្នកប្រើប្រាស់សរុប: ${rows.length}`, ''];
    for (const [uid, info] of rows) {
        const full = [info.first_name, info.last_name].filter(Boolean).join(' ') || 'N/A';
        const uname = info.username ? `@${info.username}` : '—';
        lines.push(`${full}`, `   🔖 ${uname}`, `   🪪 ${uid}`, '');
    }
    const buf = Buffer.from(lines.join('\n'), 'utf8');
    await sendDocument(chatId, buf, `users_${nowKHFile()}.txt`, `👥 បញ្ជីអ្នកប្រើប្រាស់ — ${rows.length} នាក់`);
    await sendAdminSettingsMenu(ctx, chatId);
}
async function sendKhpayInfo(ctx, chatId) {
    const token = ctx.CAMBO_API_TOKEN;
    const short = token ? `<code>${esc(token.slice(0, 16))}…${esc(token.slice(-4))}</code>` : '❌ មិនទាន់កំណត់';
    const lines = [
        '💰 <b>Cambo Payment Info</b>', '━━━━━━━━━━━━━━━━━━━',
        '🌐 <b>API:</b> <code>bakong.cambo-kh.com/api/v2</code>',
        `🔑 <b>Token:</b> ${short}`,
        '━━━━━━━━━━━━━━━━━━━',
        '✅ <b>Generate QR:</b> type=generate_qr',
        '✅ <b>Check MD5:</b> type=check_md5',
    ];
    await sendMessage(chatId, lines.join('\n'), KHPAY_SUBMENU_KB);
}
async function runBroadcast(ctx, adminChatId, bcastText) {
    const uids = Object.keys(ctx.db.users);
    let sent = 0, failed = 0, blocked = 0;
    for (const uidStr of uids) {
        const uid = Number(uidStr);
        const r = await sendMessage(uid, bcastText);
        if (r)
            sent++;
        else
            blocked++;
        await new Promise((res) => setTimeout(res, 50));
    }
    await sendMessage(adminChatId, '📢 <b>ផ្សាយ​សារ​បាន​ចប់</b>\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        `👥 សរុប:         ${uids.length}\n` +
        `✅ ផ្ញើ​ជោគជ័យ:   ${sent}\n` +
        `⛔ បាន​ប្លុក/លុប:  ${blocked}\n` +
        `❌ បរាជ័យ:        ${failed}`, ADMIN_SETTINGS_KB);
}
// ============= Admin button + input dispatch =============
async function dispatchAdminButton(ctx, chatId, uid, btn) {
    switch (btn) {
        case BTN_ADD_ACCOUNT:
            ctx.db.sessions[String(uid)] = { state: 'waiting_for_accounts' };
            return sendMessage(chatId, '<b>បញ្ចូលគូប៉ុងសម្រាប់លក់</b>', ADD_ACCOUNT_KB);
        case BTN_DELETE_TYPE: {
            const types = Object.keys(ctx.db.accounts.account_types);
            if (!types.length)
                return sendMessage(chatId, '⚠️ <b>មិនមានប្រភេទ គូប៉ុង ណាមួយទេ!</b>');
            const labelsMap = {};
            const rows = types.map((t) => {
                const count = ctx.db.accounts.account_types[t].length;
                const label = `${shortLabel(t)} – មានក្នុងស្តុក ${count}`;
                labelsMap[label] = t;
                return [label];
            });
            rows.push([BTN_BACK_SETTINGS]);
            ctx.db.sessions[String(uid)] = { state: 'delete_type_select', labels: labelsMap };
            return sendMessage(chatId, '🗑 <b>ជ្រើសរើសប្រភេទ គូប៉ុង ដែលចង់លុប៖</b>', { keyboard: rows, resize_keyboard: true, is_persistent: true });
        }
        case BTN_STOCK: return exportStock(ctx, chatId);
        case BTN_BUYERS: return exportBuyers(ctx, chatId);
        case BTN_USERS: return showUsersList(ctx, chatId);
        case BTN_KHPAY:
            return sendMessage(chatId, `💰 <b>Cambo API Token បច្ចុប្បន្ន៖</b>\n\n<code>${esc(ctx.CAMBO_API_TOKEN)}</code>`, KHPAY_SUBMENU_KB);
        case BTN_KHPAY_KEY_EDIT:
            ctx.db.sessions[String(uid)] = { state: 'admin_input:khpay_key' };
            return sendMessage(chatId, '💰 សូមផ្ញើ <b>Cambo API Token</b> ថ្មី:\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
        case BTN_KHPAY_INFO: return sendKhpayInfo(ctx, chatId);
        case BTN_CHANNEL: {
            const cur = ctx.CHANNEL_ID || '(មិនទាន់កំណត់)';
            return sendMessage(chatId, `📢 <b>Channel ID បច្ចុប្បន្ន៖</b>\n<code>${esc(String(cur))}</code>`, CHANNEL_SUBMENU_KB);
        }
        case BTN_CHANNEL_EDIT:
            ctx.db.sessions[String(uid)] = { state: 'admin_input:channel' };
            return sendMessage(chatId, '📢 សូមផ្ញើ <b>Channel ID</b> ថ្មី (ឧ. <code>-1001234567890</code>):\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
        case BTN_CHANNEL_CLEAR:
            ctx.db.settings.TELEGRAM_CHANNEL_ID = '';
            ctx.CHANNEL_ID = '';
            return sendMessage(chatId, '✅ បានលុប Channel ID', ADMIN_SETTINGS_KB);
        case BTN_ADMINS: {
            const extras = [...ctx.EXTRA_ADMIN_IDS].sort();
            const extrasStr = extras.length ? extras.map((x) => `• <code>${x}</code>`).join('\n') : '(គ្មាន)';
            return sendMessage(chatId, `👑 <b>Admin បឋម៖</b> <code>${ctx.ADMIN_ID}</code>\n\n➕ <b>Admin បន្ថែម៖</b>\n${extrasStr}`, ADMINS_SUBMENU_KB);
        }
        case BTN_ADMIN_ADD:
            ctx.db.sessions[String(uid)] = { state: 'admin_input:admin_add' };
            return sendMessage(chatId, '➕ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់បន្ថែម:', CANCEL_INPUT_KB);
        case BTN_ADMIN_REMOVE:
            ctx.db.sessions[String(uid)] = { state: 'admin_input:admin_remove' };
            return sendMessage(chatId, '➖ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់ដក:', CANCEL_INPUT_KB);
        case BTN_MAINTENANCE: {
            const status = ctx.MAINTENANCE_MODE ? '🔴 បិទ' : '🟢 បើក';
            return sendMessage(chatId, `🛠 <b>ស្ថានភាព Bot បច្ចុប្បន្ន៖</b> ${status}`, MAINTENANCE_SUBMENU_KB);
        }
        case BTN_MAINT_ON:
            ctx.db.settings.MAINTENANCE_MODE = 'true';
            ctx.MAINTENANCE_MODE = true;
            return sendMessage(chatId, '🔴 បានបិទ Bot', ADMIN_SETTINGS_KB);
        case BTN_MAINT_OFF:
            ctx.db.settings.MAINTENANCE_MODE = 'false';
            ctx.MAINTENANCE_MODE = false;
            return sendMessage(chatId, '🟢 បានបើក Bot', ADMIN_SETTINGS_KB);
        case BTN_BROADCAST:
            ctx.db.sessions[String(uid)] = { state: 'admin_input:broadcast' };
            return sendMessage(chatId, '📢 សូមផ្ញើ​សារ​ដែល​ចង់​ផ្សាយ​ទៅ​អ្នក​ប្រើ​ប្រាស់​ទាំង​អស់៖\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
        default:
            return sendAdminSettingsMenu(ctx, chatId);
    }
}
async function handleAdminInput(ctx, chatId, uid, msgId, key, text) {
    const cancelWords = new Set(['បោះបង់', '🚫 បោះបង់', BTN_CANCEL_INPUT, BTN_BACK_SETTINGS]);
    if (cancelWords.has(text)) {
        delete ctx.db.sessions[String(uid)];
        return sendAdminSettingsMenu(ctx, chatId);
    }
    if (key === 'khpay_key') {
        if (!text)
            return sendMessage(chatId, '❌ Token មិនត្រឹមត្រូវ\n\nសូមផ្ញើ Token ត្រឹមត្រូវ (ឬចុច 🚫 បោះបង់)');
        ctx.db.settings.CAMBO_API_TOKEN = text;
        ctx.CAMBO_API_TOKEN = text;
        delete ctx.db.sessions[String(uid)];
        deleteMessage(chatId, msgId).catch(() => { });
        return sendMessage(chatId, `✅ បានប្តូរ <b>Cambo API Token</b>\n<code>${esc(text.slice(0, 12))}…${esc(text.slice(-4))}</code>`, await mainKb(ctx, uid));
    }
    if (key === 'channel') {
        if (!text)
            return sendMessage(chatId, 'សូមផ្ញើ Channel ID ថ្មី ឬ <code>off</code> ដើម្បីបិទ');
        if (['off', 'none', 'clear', 'delete', 'remove'].includes(text.toLowerCase())) {
            ctx.db.settings.TELEGRAM_CHANNEL_ID = '';
            ctx.CHANNEL_ID = '';
        }
        else {
            ctx.db.settings.TELEGRAM_CHANNEL_ID = text;
            ctx.CHANNEL_ID = text;
        }
        delete ctx.db.sessions[String(uid)];
        return sendMessage(chatId, `✅ បានកំណត់ Channel ID ទៅជា <code>${esc(ctx.CHANNEL_ID || '(ទទេ)')}</code>`, await mainKb(ctx, uid));
    }
    if (key === 'admin_add') {
        const target = parseInt(text, 10);
        if (isNaN(target))
            return sendMessage(chatId, '❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)');
        if (target === ctx.ADMIN_ID) {
            delete ctx.db.sessions[String(uid)];
            return sendMessage(chatId, 'ℹ️ Admin បឋមមិនអាចលុប/បន្ថែមបានទេ។', await mainKb(ctx, uid));
        }
        ctx.EXTRA_ADMIN_IDS.add(target);
        ctx.db.settings.EXTRA_ADMIN_IDS = JSON.stringify([...ctx.EXTRA_ADMIN_IDS]);
        delete ctx.db.sessions[String(uid)];
        return sendMessage(chatId, `✅ បានបន្ថែម <code>${target}</code> ជា admin`);
    }
    if (key === 'admin_remove') {
        const target = parseInt(text, 10);
        if (isNaN(target))
            return sendMessage(chatId, '❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)');
        ctx.EXTRA_ADMIN_IDS.delete(target);
        ctx.db.settings.EXTRA_ADMIN_IDS = JSON.stringify([...ctx.EXTRA_ADMIN_IDS]);
        delete ctx.db.sessions[String(uid)];
        return sendMessage(chatId, `✅ បានដក <code>${target}</code> ចាក admin`);
    }
    if (key === 'broadcast') {
        ctx.db.sessions[String(uid)] = {
            state: 'broadcast_confirm',
            broadcast_message_id: msgId,
            broadcast_chat_id: chatId,
            broadcast_use_copy: true,
            broadcast_text: text,
        };
        return sendMessage(chatId, `📢 <b>ព្រមព្រៀងផ្សាយ:</b>\n\n${esc(text)}\n\n<i>ផ្សាយទៅអ្នកប្រើ ${Object.keys(ctx.db.users).length} នាក់</i>`, BROADCAST_CONFIRM_KB);
    }
}
export async function handleUpdate(update, preDb) {
    const db = preDb ?? (await loadDB());
    const ctx = loadCtx(db);
    try {
        if (update.channel_post) {
            await handleChannelPost(ctx, update.channel_post);
        }
        else if (update.callback_query) {
            await handleCallback(ctx, update.callback_query);
        }
        else if (update.message) {
            await handleMessage(ctx, update.message);
        }
    }
    catch (e) {
        console.warn('[BotError]', e.message);
    }
    const savePromise = saveDB(ctx.db);
    const hasPending = Object.values(ctx.db.sessions).some((s) => s.state === 'payment_pending');
    if (hasPending) {
        runWatchdog().catch((e) => console.warn('[Watchdog] post-update:', e.message));
    }
    await savePromise;
}
async function handleMessage(ctx, msg) {
    if (!msg.from)
        return;
    const uid = msg.from.id;
    const chatId = msg.chat.id;
    const text = (msg.text ?? '').trim();
    await notifyAdminNewUser(ctx, msg.from);
    if (text === '/start' || text.startsWith('/start ')) {
        if (ctx.MAINTENANCE_MODE && !isAdmin(ctx, uid)) {
            await sendMessage(chatId, '🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>');
            return;
        }
        const sess = ctx.db.sessions[String(uid)];
        if (sess?.state === 'payment_pending') {
            await sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្តើមការទិញថ្មី។');
            return;
        }
        delete ctx.db.sessions[String(uid)];
        if (isAdmin(ctx, uid)) {
            await sendMessage(chatId, '👋 <b>សួស្ដី Admin</b>', await mainKb(ctx, uid));
        }
        await showAccountSelection(ctx, chatId);
        return;
    }
    if (ctx.MAINTENANCE_MODE && !isAdmin(ctx, uid)) {
        await sendMessage(chatId, '🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>');
        return;
    }
    if (isAdmin(ctx, uid)) {
        const sess = ctx.db.sessions[String(uid)] ?? {};
        const state = sess.state ?? '';
        if (text === BTN_BACK_SETTINGS) {
            delete ctx.db.sessions[String(uid)];
            return sendAdminSettingsMenu(ctx, chatId);
        }
        if (state.startsWith('admin_input:')) {
            return handleAdminInput(ctx, chatId, uid, msg.message_id, state.slice('admin_input:'.length), text);
        }
        if (state === 'delete_type_select') {
            const labels = sess.labels || {};
            const typeName = labels[text];
            if (typeName && ctx.db.accounts.account_types[typeName] !== undefined) {
                const count = ctx.db.accounts.account_types[typeName].length;
                const price = ctx.db.accounts.prices[typeName] ?? 0;
                ctx.db.sessions[String(uid)] = { state: 'delete_type_confirm', type_name: typeName };
                return sendMessage(chatId, `⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: ${esc(typeName)}\n🔹 ចំនួន: ${count}\n🔹 តម្លៃ: $${price}</blockquote>`, { keyboard: [[BTN_DELETE_CONFIRM], [BTN_DELETE_CANCEL]], resize_keyboard: true, is_persistent: true });
            }
            return;
        }
        if (state === 'delete_type_confirm') {
            const typeName = sess.type_name;
            delete ctx.db.sessions[String(uid)];
            if (text === BTN_DELETE_CONFIRM && typeName) {
                const count = (ctx.db.accounts.account_types[typeName] ?? []).length;
                delete ctx.db.accounts.account_types[typeName];
                delete ctx.db.accounts.prices[typeName];
                return sendMessage(chatId, `✅ <b>បានលុបប្រភេទ <code>${esc(typeName)}</code> ចំនួន ${count} records!</b>`, ADMIN_SETTINGS_KB);
            }
            return sendMessage(chatId, '🚫 <b>បានបោះបង់ការលុប</b>', ADMIN_SETTINGS_KB);
        }
        if (state === 'broadcast_confirm') {
            const bcastText = sess.broadcast_text || '';
            delete ctx.db.sessions[String(uid)];
            if (text === BTN_BROADCAST_CONFIRM && bcastText) {
                await sendMessage(chatId, '📢 កំពុង​ផ្សាយ​សារ ... សូមរង់ចាំ', ADMIN_SETTINGS_KB);
                await saveDB(ctx.db);
                await runBroadcast(ctx, chatId, bcastText);
                return;
            }
            return sendMessage(chatId, '🚫 <b>បាន​បោះបង់​ការ​ផ្សាយ</b>', ADMIN_SETTINGS_KB);
        }
        if (state === 'waiting_for_accounts') {
            if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
                delete ctx.db.sessions[String(uid)];
                return sendAdminSettingsMenu(ctx, chatId);
            }
            const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
            if (!lines.length)
                return sendMessage(chatId, '<b>អ៊ីមែលមិនត្រឹមត្រូវតាមទម្រង់</b>', ADD_ACCOUNT_KB);
            const newAccounts = lines.map((l) => {
                if (l.includes('|')) {
                    const [ph, pw] = l.split('|').map((s) => s.trim());
                    return { phone: ph, password: pw };
                }
                return { code: l };
            });
            const existingTypes = Object.keys(ctx.db.accounts.account_types);
            ctx.db.sessions[String(uid)] = { state: 'waiting_for_account_type', accounts: newAccounts };
            const typeRows = [...existingTypes.map((t) => [t]), [BTN_BACK_SETTINGS]];
            return sendMessage(chatId, `<b>បានបញ្ចូល គូប៉ុង ចំនួន ${newAccounts.length}\n\nសូមជ្រើសរើស ឬបញ្ចូលប្រភេទ គូប៉ុង៖</b>`, { keyboard: typeRows, resize_keyboard: true, is_persistent: true });
        }
        if (state === 'waiting_for_account_type') {
            if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
                delete ctx.db.sessions[String(uid)];
                return sendAdminSettingsMenu(ctx, chatId);
            }
            const existingPrice = ctx.db.accounts.prices[text];
            ctx.db.sessions[String(uid)] = { ...sess, state: 'waiting_for_price', account_type: text };
            if (existingPrice != null) {
                return sendMessage(chatId, `<b>ប្រភេទ <code>${esc(text)}</code> មានស្រាប់ ដែលមានតម្លៃ ${existingPrice}$\n\nតម្លៃត្រូវតែដូចគ្នា (${existingPrice}$) ដើម្បីបន្ថែម គូប៉ុង</b>`, ADD_ACCOUNT_KB);
            }
            return sendMessage(chatId, `<b>សូមដាក់តម្លៃក្នុងប្រភេទ គូប៉ុង ${esc(text)}</b>`, ADD_ACCOUNT_KB);
        }
        if (state === 'waiting_for_price') {
            if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
                delete ctx.db.sessions[String(uid)];
                return sendAdminSettingsMenu(ctx, chatId);
            }
            const price = parseFloat(text.replace('$', '').trim());
            if (isNaN(price) || price < 0)
                return sendMessage(chatId, 'តម្លៃមិនត្រឹមត្រូវ។ សូមបញ្ចូលតម្លៃជាលេខ (ឧ: 5.99)');
            const accountType = sess.account_type;
            const accsToAdd = sess.accounts ?? [];
            const existingPrice = ctx.db.accounts.prices[accountType];
            if (existingPrice != null && Math.round(existingPrice * 10000) !== Math.round(price * 10000)) {
                return sendMessage(chatId, `❌ <b>មិនអាចបញ្ចូលបាន!</b>\n\nប្រភេទ <code>${esc(accountType)}</code> មានតម្លៃ <b>${existingPrice}$</b> ស្រាប់។\nតម្លៃ <b>${price}$</b> មិនដូចគ្នា។ សូមប្រើ <b>${existingPrice}$</b>`, ADD_ACCOUNT_KB);
            }
            const allExisting = new Set(Object.values(ctx.db.accounts.account_types).flat().map((a) => (a.code || a.email || a.phone || '').toLowerCase()).filter(Boolean));
            const toAdd = accsToAdd.filter((a) => !allExisting.has((a.code || a.email || a.phone || '').toLowerCase()));
            const dupes = accsToAdd.length - toAdd.length;
            if (!ctx.db.accounts.account_types[accountType])
                ctx.db.accounts.account_types[accountType] = [];
            ctx.db.accounts.account_types[accountType].push(...toAdd);
            ctx.db.accounts.prices[accountType] = Math.round(price * 10000) / 10000;
            delete ctx.db.sessions[String(uid)];
            await sendMessage(chatId, `✅ <b>បានបញ្ចូល គូប៉ុង ដោយជោគជ័យ</b>\n\n<blockquote>🔹 ចំនួន: ${toAdd.length}\n🔹 ប្រភេទ: ${esc(accountType)}\n🔹 តម្លៃ: ${price}$</blockquote>` + (dupes ? `\n\n⚠️ ដដែល (រំលង): ${dupes}` : ''));
            return sendAdminSettingsMenu(ctx, chatId);
        }
        if (ADMIN_BUTTON_LABELS.has(text))
            return dispatchAdminButton(ctx, chatId, uid, text);
    }
    if (text === '💵 ទិញគូប៉ុង') {
        const sess = ctx.db.sessions[String(uid)];
        if (sess?.state === 'payment_pending') {
            return sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្ដើមការទិញថ្មី។');
        }
        delete ctx.db.sessions[String(uid)];
        return showAccountSelection(ctx, chatId);
    }
    if (ctx.db.sessions[String(uid)]?.state === 'payment_pending') {
        return sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទូទាត់ QR ជាមុនសិន</b>\nឬចុច <b>🚫 បោះបង់</b> ដើម្បីបោះបង់', CHECK_PAYMENT_INLINE);
    }
    if (isAdmin(ctx, uid))
        await sendMessage(chatId, '⚙️', await mainKb(ctx, uid)).catch(() => { });
    else
        await sendMessage(chatId, '💵', MAIN_KB).catch(() => { });
    await showAccountSelection(ctx, chatId);
}
async function handleCallback(ctx, cb) {
    const data = cb.data ?? '';
    const uid = cb.from.id;
    const chatId = cb.message?.chat?.id ?? uid;
    const msgId = cb.message?.message_id;
    await notifyAdminNewUser(ctx, cb.from);
    if (data.startsWith('buy:')) {
        const at = typeFromCbId(ctx, data.slice(4));
        if (!at)
            return answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ។', true);
        const sess = ctx.db.sessions[String(uid)];
        if (sess?.state === 'payment_pending')
            return answerCallbackQuery(cb.id, 'សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន', true);
        await answerCallbackQuery(cb.id);
        const pool = ctx.db.accounts.account_types[at] ?? [];
        const price = ctx.db.accounts.prices[at] ?? 0;
        if (pool.length <= 0)
            return sendMessage(chatId, `<i>សូមអភ័យទោស គូប៉ុង ${esc(at)} អស់ពីស្តុក 🪤</i>`);
        const old = ctx.db.sessions[String(uid)];
        if (old?.reserved_accounts?.length && old.account_type) {
            ctx.db.accounts.account_types[old.account_type] = [...old.reserved_accounts, ...(ctx.db.accounts.account_types[old.account_type] ?? [])];
        }
        ctx.db.sessions[String(uid)] = {
            state: 'waiting_for_quantity', account_type: at, price, available_count: pool.length, started_at: Date.now(),
        };
        const typeCbId = typeCallbackId(at);
        const qtyBtns = Array.from({ length: Math.min(pool.length, 25) }, (_, i) => ({
            text: String(i + 1),
            callback_data: `qty:${typeCbId}:${i + 1}`,
        }));
        const rows = [];
        for (let i = 0; i < qtyBtns.length; i += 5)
            rows.push(qtyBtns.slice(i, i + 5));
        rows.push([{ text: '🚫 បោះបង់', callback_data: 'cancel_buy' }]);
        if (msgId) {
            await editMessageText(chatId, msgId, `<b>សូមជ្រើសរើសចំនួនដែលចង់ទិញ៖</b>\n\nប្រភេទ៖ ${esc(at)} – តម្លៃ $${price} ក្នុងមួយ`, { inline_keyboard: rows });
        }
        else {
            await sendMessage(chatId, '<b>សូមជ្រើសរើសចំនួនដែលចង់ទិញ៖</b>', { inline_keyboard: rows });
        }
        return;
    }
    if (data.startsWith('qty:')) {
        const parts = data.split(':');
        let at = null, qty = 0;
        if (parts.length === 3) {
            at = typeFromCbId(ctx, parts[1]);
            qty = parseInt(parts[2], 10);
        }
        else if (parts.length === 2)
            qty = parseInt(parts[1], 10);
        if (!qty || qty < 1)
            return answerCallbackQuery(cb.id);
        const sess = ctx.db.sessions[String(uid)];
        if (!sess || sess.state !== 'waiting_for_quantity')
            return answerCallbackQuery(cb.id);
        if (at && sess.account_type !== at)
            return answerCallbackQuery(cb.id, 'ប្រភេទផ្លាស់ប្ដូរ — ចាប់ផ្ដើមម្ដងទៀត', true);
        if (qty > (sess.available_count ?? 0))
            return answerCallbackQuery(cb.id, `សុំទោស! មានត្រឹមតែ ${sess.available_count} នៅក្នុងស្តុក`, true);
        sess.quantity = qty;
        sess.total_price = Math.round(qty * (sess.price ?? 0) * 100) / 100;
        if (msgId)
            deleteMessage(chatId, msgId).catch(() => { });
        await startPaymentForSession(ctx, chatId, uid, sess, cb.id);
        return;
    }
    if (data === 'cancel_buy') {
        await answerCallbackQuery(cb.id);
        const sess = ctx.db.sessions[String(uid)];
        if (sess?.reserved_accounts?.length && sess.account_type) {
            ctx.db.accounts.account_types[sess.account_type] = [...sess.reserved_accounts, ...(ctx.db.accounts.account_types[sess.account_type] ?? [])];
        }
        delete ctx.db.sessions[String(uid)];
        if (msgId)
            deleteMessage(chatId, msgId).catch(() => { });
        await showAccountSelection(ctx, chatId);
        return;
    }
    if (data === 'cancel_purchase') {
        const sess = ctx.db.sessions[String(uid)];
        const txnId = sess?.transaction_id;
        if (txnId) {
            try {
                const { paid, data: pd } = await checkKhpayStatus(ctx.CAMBO_API_TOKEN, txnId, sess?.md5 ?? null);
                if (paid) {
                    await answerCallbackQuery(cb.id, '✅ បានទទួលការបង់ប្រាក់!');
                    await deliverAccounts(ctx, chatId, uid, sess, pd);
                    return;
                }
            }
            catch { /* ignore */ }
        }
        await answerCallbackQuery(cb.id);
        if (sess) {
            const { account_type, reserved_accounts = [] } = sess;
            if (reserved_accounts.length && account_type) {
                ctx.db.accounts.account_types[account_type] = [...reserved_accounts, ...(ctx.db.accounts.account_types[account_type] ?? [])];
            }
            for (const k of ['photo_message_id', 'qr_message_id']) {
                const mid = sess[k];
                if (mid)
                    deleteMessage(chatId, mid).catch(() => { });
            }
            delete ctx.db.sessions[String(uid)];
        }
        await showAccountSelection(ctx, chatId);
        return;
    }
    if (data === 'check_payment') {
        const sess = ctx.db.sessions[String(uid)];
        const txnId = sess?.transaction_id;
        if (!txnId)
            return answerCallbackQuery(cb.id, '⚠️ រកមិនឃើញការទូទាត់', true);
        await answerCallbackQuery(cb.id, '⏳ កំពុងពិនិត្យ…');
        try {
            const { paid, data: pd } = await checkKhpayStatus(ctx.CAMBO_API_TOKEN, txnId, sess?.md5 ?? null);
            if (paid)
                await deliverAccounts(ctx, chatId, uid, sess, pd);
            else
                await answerCallbackQuery(cb.id, '❌ មិនទាន់បង់ប្រាក់ទេ', true);
        }
        catch (e) {
            await answerCallbackQuery(cb.id, '❌ មានបញ្ហា: ' + e.message, true);
        }
        return;
    }
    if (data.startsWith('dts:') && isAdmin(ctx, uid)) {
        const typeName = typeFromCbId(ctx, data.slice(4)) || data.slice(4);
        if (!ctx.db.accounts.account_types[typeName])
            return answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ!', true);
        await answerCallbackQuery(cb.id);
        const count = ctx.db.accounts.account_types[typeName].length;
        const price = ctx.db.accounts.prices[typeName] ?? 0;
        await sendMessage(chatId, `⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: ${esc(typeName)}\n🔹 ចំនួន: ${count}\n🔹 តម្លៃ: $${price}</blockquote>`, { inline_keyboard: [[
                    { text: '✅ បញ្ជាក់លុប', callback_data: `dtc:${typeCallbackId(typeName)}` },
                    { text: '🚫 បោះបង់', callback_data: 'dtcancel' },
                ]] });
        return;
    }
    if (data.startsWith('dtc:') && isAdmin(ctx, uid)) {
        const typeName = typeFromCbId(ctx, data.slice(4)) || data.slice(4);
        if (!ctx.db.accounts.account_types[typeName])
            return answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ!', true);
        await answerCallbackQuery(cb.id);
        const count = (ctx.db.accounts.account_types[typeName] ?? []).length;
        delete ctx.db.accounts.account_types[typeName];
        delete ctx.db.accounts.prices[typeName];
        if (msgId)
            deleteMessage(chatId, msgId).catch(() => { });
        await sendMessage(chatId, `✅ <b>បានលុប <code>${esc(typeName)}</code> ចំនួន ${count} records!</b>`);
        return;
    }
    if (data === 'dtcancel' && isAdmin(ctx, uid)) {
        await answerCallbackQuery(cb.id);
        if (msgId)
            deleteMessage(chatId, msgId).catch(() => { });
        await sendMessage(chatId, '🚫 <b>បានបោះបង់ការលុប</b>');
        return;
    }
    await answerCallbackQuery(cb.id);
}
async function handleChannelPost(ctx, post) {
    try {
        const text = post.text || post.caption || '';
        if (!text)
            return;
        if (!text.includes('noreply@e-gets.com') && !text.includes('e-gets.com'))
            return;
        const emailMatch = text.match(/📧[^\n:]*:\s*([^\s\n]+)/);
        if (!emailMatch) {
            console.log('[EGets] No email extracted');
            return;
        }
        const email = emailMatch[1].trim();
        const codeMatch = text.match(/^\s*(\d{4,8})\s*$/m);
        if (!codeMatch) {
            console.log(`[EGets] No code for ${email}`);
            return;
        }
        const code = codeMatch[1].trim();
        const matched = ctx.db.purchases.filter((p) => (p.accounts || []).some((a) => (a.email || a.code || '').trim().toLowerCase() === email.toLowerCase()));
        if (!matched.length) {
            console.log(`[EGets] no buyer for ${email}`);
            return;
        }
        const sent = new Set();
        for (const p of matched) {
            if (sent.has(p.user_id))
                continue;
            sent.add(p.user_id);
            const msg = `📩 <b>លេខកូដផ្ទៀងផ្ទាត់ E-GetS</b>\n\n<code>${esc(email)}</code>\n\n<code>${code}</code>`;
            await sendMessage(p.user_id, msg).catch(() => { });
        }
    }
    catch (e) {
        console.warn('[EGets] channel_post error:', e.message);
    }
}
// ============= HTTP Handlers =============
function _deriveWebhookSecret(apiKey) {
    return createHash('sha256').update(`telegram-webhook:${apiKey}`).digest('base64url');
}
function _safeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
export async function handleWebhookRequest(request) {
    const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
    if (!TELEGRAM_API_KEY)
        return new Response('Server misconfigured', { status: 500 });
    const expected = _deriveWebhookSecret(TELEGRAM_API_KEY);
    const actual = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!_safeEqual(actual, expected))
        return new Response('Unauthorized', { status: 401 });
    let update;
    try {
        update = await request.json();
    }
    catch {
        return new Response('Bad request', { status: 400 });
    }
    if (typeof update.update_id !== 'number')
        return Response.json({ ok: true, ignored: true });
    const work = (async () => {
        try {
            const [fresh, db] = await Promise.all([markUpdateProcessed(update.update_id), loadDB()]);
            if (!fresh)
                return;
            await handleUpdate(update, db);
            runWatchdog().catch(() => { });
        }
        catch (e) {
            console.warn('[webhook] bg error:', e.message);
        }
    })();
    const wu = globalThis.__waitUntil;
    if (wu) {
        wu(work);
        return Response.json({ ok: true });
    }
    await work;
    return Response.json({ ok: true });
}
export async function handleCronRequest() {
    const maxMs = 59_000, intervalMs = 500;
    const start = Date.now();
    let runs = 0;
    while (Date.now() - start < maxMs) {
        try {
            await runWatchdog();
        }
        catch (e) {
            console.warn('[cron] watchdog error:', e.message);
        }
        runs++;
        if (Date.now() - start + intervalMs >= maxMs)
            break;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return Response.json({ ok: true, runs });
}
//# sourceMappingURL=bot.js.map