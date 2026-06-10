// Main Telegram bot dispatcher — webhook-driven.
import { loadDB, saveDB, type BotDB, type Session, type Account } from './state';
import * as tg from './api';
import { createKhpayPayment, checkKhpayStatus } from './cambo';
import {
  ADMIN_BUTTON_LABELS, ADMIN_KB, ADMIN_SETTINGS_BTN, ADMIN_SETTINGS_KB,
  ADMINS_SUBMENU_KB, ADD_ACCOUNT_KB, BACK_SETTINGS_KB, BROADCAST_CONFIRM_KB,
  BTN_ADD_ACCOUNT, BTN_ADMINS, BTN_ADMIN_ADD, BTN_ADMIN_REMOVE,
  BTN_BACK_SETTINGS, BTN_BROADCAST, BTN_BROADCAST_CANCEL, BTN_BROADCAST_CONFIRM,
  BTN_BUYERS, BTN_CANCEL_INPUT, BTN_CHANNEL, BTN_CHANNEL_CLEAR, BTN_CHANNEL_EDIT,
  BTN_DELETE_CANCEL, BTN_DELETE_CONFIRM, BTN_DELETE_TYPE, BTN_KHPAY,
  BTN_KHPAY_INFO, BTN_KHPAY_KEY_EDIT, BTN_MAINTENANCE, BTN_MAINT_OFF,
  BTN_MAINT_ON, BTN_STOCK, BTN_USERS, CANCEL_INPUT_KB, CHANNEL_SUBMENU_KB,
  CHECK_PAYMENT_INLINE, KHPAY_SUBMENU_KB, MAINTENANCE_SUBMENU_KB, MAIN_KB,
  PAYMENT_TIMEOUT_SEC, REMOVE_KB, esc, formatAccount, fmtKH, nowKH, nowKHFile,
  shortLabel, typeCallbackId,
} from './constants';
import type { ReplyMarkup } from './api';

// ============= Context loaded per-request =============

interface BotCtx {
  db: BotDB;
  ADMIN_ID: number;
  EXTRA_ADMIN_IDS: Set<number>;
  CHANNEL_ID: string;
  CAMBO_API_TOKEN: string;
  MAINTENANCE_MODE: boolean;
}

function loadCtx(db: BotDB): BotCtx {
  const ADMIN_ID = Number(process.env.ADMIN_ID || '5002402843');
  const ea = db.settings.EXTRA_ADMIN_IDS;
  let EXTRA: Set<number> = new Set();
  if (ea) { try { EXTRA = new Set((JSON.parse(ea) as number[]).map(Number)); } catch { /* ignore */ } }
  return {
    db,
    ADMIN_ID,
    EXTRA_ADMIN_IDS: EXTRA,
    CHANNEL_ID: db.settings.TELEGRAM_CHANNEL_ID ?? '',
    CAMBO_API_TOKEN: db.settings.CAMBO_API_TOKEN ?? process.env.CAMBO_API_TOKEN ?? '',
    MAINTENANCE_MODE: db.settings.MAINTENANCE_MODE === 'true',
  };
}

const isAdmin = (ctx: BotCtx, uid: number) =>
  Number(uid) === ctx.ADMIN_ID || ctx.EXTRA_ADMIN_IDS.has(Number(uid));

const mainKb = (ctx: BotCtx, uid: number): ReplyMarkup =>
  isAdmin(ctx, uid) ? ADMIN_KB : REMOVE_KB;

const typeFromCbId = (ctx: BotCtx, cid: string) =>
  Object.keys(ctx.db.accounts.account_types).find((t) => typeCallbackId(t) === cid) ?? null;

// ============= Common UI =============

async function notifyAdminNewUser(ctx: BotCtx, user: { id: number; first_name?: string; last_name?: string; username?: string }) {
  const uid = user.id;
  if (uid === ctx.ADMIN_ID || ctx.db.users[String(uid)]) return;
  ctx.db.users[String(uid)] = {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || '',
    first_seen: new Date().toISOString(),
  };
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A';
  const uname = user.username ? `@${user.username}` : '—';
  // fire-and-forget — don't block the user's reply on admin notification
  tg.sendMessage(
    ctx.ADMIN_ID,
    `🆕 <b>អ្នកប្រើប្រាស់ថ្មី!</b>\n\n👤 ឈ្មោះ: ${esc(full)}\n🔖 Username: ${esc(uname)}\n🪪 ID: <code>${uid}</code>`,
  ).catch(() => {});
}

async function showAccountSelection(ctx: BotCtx, chatId: number) {
  const available = Object.entries(ctx.db.accounts.account_types)
    .filter(([, v]) => v.length > 0)
    .map(([at, v]) => ({ at, count: v.length }));
  if (!available.length) {
    await tg.sendMessage(chatId, '<i>សូមអភ័យទោស អស់ពីស្តុក 🪤</i>');
    return;
  }
  const rows = available.map(({ at, count }) => [
    { text: `${at} – មានក្នុងស្តុក ${count}`, callback_data: `buy:${typeCallbackId(at)}` },
  ]);
  await tg.sendMessage(chatId, '<b>សូមជ្រើសរើសគូប៉ុងដើម្បីទិញ៖</b>', { inline_keyboard: rows });
}

async function sendAdminSettingsMenu(_ctx: BotCtx, chatId: number) {
  await tg.sendMessage(chatId, '<b>⚙️ ការកំណត់ Admin</b>\n\nសូមជ្រើសរើសប្រតិបត្តិការខាងក្រោម៖', ADMIN_SETTINGS_KB);
}

// ============= Payment =============

async function startPaymentForSession(ctx: BotCtx, chatId: number, userId: number, session: Session, cbId?: string) {
  const at = session.account_type!;
  const qty = session.quantity!;
  const pool = ctx.db.accounts.account_types[at] ?? [];
  if (pool.length < qty) {
    if (cbId) await tg.answerCallbackQuery(cbId, `សូមអភ័យទោស! មានត្រឹមតែ ${pool.length} គូប៉ុង នៅក្នុងស្តុក`, true);
    delete ctx.db.sessions[String(userId)];
    return false;
  }
  // Reserve coupons for this session so they're removed from stock
  // while payment is pending. Returned to pool on timeout/cancel.
  session.reserved_accounts = pool.slice(0, qty);
  ctx.db.accounts.account_types[at] = pool.slice(qty);
  session.available_count = ctx.db.accounts.account_types[at].length;
  if (cbId) await tg.answerCallbackQuery(cbId, 'កំពុងបង្កើត QR...');

  session.state = 'payment_pending';
  const { imgBuffer, transaction_id, md5, error } = await createKhpayPayment(ctx.CAMBO_API_TOKEN, session.total_price!);
  if (!imgBuffer || !transaction_id) {
    if (isAdmin(ctx, userId)) {
      await tg.sendMessage(chatId, `❌ <b>QR បរាជ័យ (Admin Debug):</b>\n<code>${esc(String(error))}</code>`);
    } else {
      await tg.sendMessage(chatId, '❌ <b>មានបញ្ហាក្នុងការបង្កើត QR Code</b>\n\nសូមព្យាយាមម្ដងទៀត។');
      await tg.sendMessage(ctx.ADMIN_ID, `⚠️ QR Error (user ${userId}): <code>${esc(String(error))}</code>`);
    }
    delete ctx.db.sessions[String(userId)];
    return false;
  }
  session.transaction_id = transaction_id;
  session.md5 = md5 ?? null;
  session.qr_sent_at = Date.now();
  const photo = await tg.sendPhoto(chatId, imgBuffer, { reply_markup: CHECK_PAYMENT_INLINE });
  if (photo) {
    session.photo_message_id = photo.message_id;
    session.qr_message_id = photo.message_id;
  }
  ctx.db.sessions[String(userId)] = session;
  console.log(`[INFO] KhPay QR sent to user ${userId}: $${session.total_price}, TxnID: ${transaction_id}`);
  return true;
}

async function deliverAccounts(ctx: BotCtx, chatId: number, userId: number, session: Session, paymentData: Record<string, unknown> | null = null) {
  const at = session.account_type!;
  const qty = session.quantity!;
  for (const k of ['photo_message_id', 'qr_message_id'] as const) {
    const mid = session[k];
    if (mid) tg.deleteMessage(chatId, mid).catch(() => {});
  }
  let delivered: Account[] | null = null;
  const reserved = session.reserved_accounts ?? [];
  if (reserved.length >= qty) {
    delivered = reserved.slice(0, qty);
  } else if ((ctx.db.accounts.account_types[at] ?? []).length >= qty) {
    const pool = ctx.db.accounts.account_types[at];
    delivered = pool.slice(0, qty);
    ctx.db.accounts.account_types[at] = pool.slice(qty);
  }
  session.reserved_accounts = [];
  delete ctx.db.sessions[String(userId)];
  if (!delivered) {
    await tg.sendMessage(chatId, `❌ <b>មានបញ្ហា!</b>\n\nគ្មាន គូប៉ុង ប្រភេទ ${esc(at)} ក្នុងស្តុក។`);
    return;
  }
  ctx.db.purchases.push({
    user_id: userId,
    account_type: at,
    quantity: qty,
    total_price: session.total_price!,
    accounts: delivered,
    purchased_at: new Date().toISOString(),
  });
  for (let i = 0; i < delivered.length; i++) {
    const acc = delivered[i];
    const isLast = i === delivered.length - 1;
    const msg = `🎉 <b>ការទិញបានបញ្ជាក់ដោយជោគជ័យ</b>\n\nគូប៉ុងរបស់អ្នក៖ 👇\n\n<code>${esc(formatAccount(acc))}</code>\n\n<i>សូមអរគុណសម្រាប់ការទិញ 🙏</i>`;
    await tg.sendMessage(chatId, msg, isLast ? mainKb(ctx, userId) : undefined);
  }
  try {
    const pd = paymentData || {};
    const fromAcc = (pd.fromAccountId as string) || (pd.hash as string) || 'N/A';
    const memo = (pd.memo as string) || 'គ្មាន';
    const ref = (pd.externalRef as string) || (pd.transactionId as string) || (pd.md5 as string) || 'N/A';
    const adminMsg =
      '🎉 <b>ទទួលបានការបង់ប្រាក់ជោគជ័យ</b>\n' +
      '━━━━━━━━━━━━━━━━━━━\n' +
      `🆔 <b>អ្នកទិញ(ID):</b> ${userId}\n` +
      `📦 <b>ប្រភេទ:</b> ${esc(at)} × ${qty}\n` +
      `💵 <b>ទឹកប្រាក់:</b> $${session.total_price}\n` +
      `👤 <b>ពីធនាគារ:</b> <code>${esc(fromAcc)}</code>\n` +
      `📝 <b>ចំណាំ:</b> ${esc(memo)}\n` +
      `🧾 <b>លេខយោង:</b> <code>${esc(ref)}</code>\n` +
      `⏰ <b>ម៉ោង:</b> ${nowKH()}`;
    tg.sendMessage(ctx.ADMIN_ID, adminMsg).catch(() => {});
    if (ctx.CHANNEL_ID && String(ctx.CHANNEL_ID) !== String(ctx.ADMIN_ID)) {
      tg.sendMessage(ctx.CHANNEL_ID, adminMsg).catch(() => {});
    }
  } catch (e) {
    console.warn('[WARN] admin payment notify:', (e as Error).message);
  }
  console.log(`[INFO] Delivered ${qty}× ${at} to user ${userId}`);
}

// Run on each webhook and via cron — checks pending sessions.
// Accepts an optional pre-loaded ctx to avoid a redundant DB roundtrip.
export async function runWatchdog(preCtx?: BotCtx): Promise<void> {
  let ctx: BotCtx;
  if (preCtx) {
    ctx = preCtx;
  } else {
    const db = await loadDB();
    ctx = loadCtx(db);
  }
  const db = ctx.db;
  const pending = Object.entries(db.sessions).filter(([, s]) => s.state === 'payment_pending');
  if (!pending.length) return;
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
      if (sess.photo_message_id) tg.deleteMessage(userId, sess.photo_message_id).catch(() => {});
      await tg.sendMessage(userId, '⌛ <b>QR Code បានផុតកំណត់</b>\n\nសូមបង្កើតការទិញម្ដងទៀត។').catch(() => {});
      await showAccountSelection(ctx, userId).catch(() => {});
      continue;
    }
    if (!sess.transaction_id) continue;
    try {
      const { paid, data: payData } = await checkKhpayStatus(ctx.CAMBO_API_TOKEN, sess.transaction_id, sess.md5 ?? null);
      if (!paid) continue;
      const cur = db.sessions[uidStr];
      if (!cur || cur.transaction_id !== sess.transaction_id || cur.state !== 'payment_pending') continue;
      cur.state = 'delivering';
      dirty = true;
      await deliverAccounts(ctx, userId, userId, cur, payData);
    } catch (e) {
      console.warn(`[Watchdog] check error ${sess.transaction_id}:`, (e as Error).message);
    }
  }
  if (dirty || pending.length) await saveDB(db);
}

// ============= Admin export helpers =============

async function exportStock(ctx: BotCtx, chatId: number) {
  const types = ctx.db.accounts.account_types;
  const prices = ctx.db.accounts.prices;
  const names = Object.keys(types).sort();
  if (!names.length) { await tg.sendMessage(chatId, '📦 មិនមានប្រភេទ គូប៉ុង ឡើយទេ។', ADMIN_SETTINGS_KB); return; }
  const totalAvail = names.reduce((s, t) => s + (types[t] || []).length, 0);
  const W = 60;
  const lines: string[] = [
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
    if (pool.length) pool.forEach((acc, i) => lines.push(`  ${i + 1}. ${formatAccount(acc)}`));
    else lines.push('  (គ្មានក្នុងស្តុក)');
    lines.push('');
  }
  lines.push('='.repeat(W));
  const buf = Buffer.from(lines.join('\n'), 'utf8');
  await tg.sendDocument(chatId, buf, `stock_${nowKHFile()}.txt`, `📦 <b>ស្តុក គូប៉ុង</b> — ${names.length} ប្រភេទ, ${totalAvail} នៅសល់`);
  await sendAdminSettingsMenu(ctx, chatId);
}

async function exportBuyers(ctx: BotCtx, chatId: number) {
  if (!ctx.db.purchases.length) { await tg.sendMessage(chatId, 'មិនមានទិន្នន័យ​ទិញ​នៅឡើយ​ទេ។', ADMIN_SETTINGS_KB); return; }
  const grouped: Record<string, { first_name: string; last_name: string; username: string; purchases: typeof ctx.db.purchases }> = {};
  for (const p of ctx.db.purchases) {
    const uid = String(p.user_id);
    if (!grouped[uid]) {
      const u = ctx.db.users[uid] || { first_name: '', last_name: '', username: '', first_seen: '' };
      grouped[uid] = { first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '', purchases: [] };
    }
    grouped[uid].purchases.push(p);
  }
  const W = 60;
  const lines: string[] = ['='.repeat(W), '  BUYERS REPORT'.padEnd(W), `  ${nowKH()}`.padEnd(W), '='.repeat(W), `  Total buyers : ${Object.keys(grouped).length}`];
  for (const [uid, info] of Object.entries(grouped)) {
    const fn = [info.first_name, info.last_name].filter(Boolean).join(' ') || '(no name)';
    const un = info.username ? `@${info.username}` : '—';
    lines.push('', '─'.repeat(W), `  ID       : ${uid}`, `  Name     : ${fn}`, `  Username : ${un}`, `  Purchases: ${info.purchases.length}`, '─'.repeat(W));
    info.purchases.forEach((p, i) => {
      lines.push(`  [${i + 1}] ${p.account_type}`, `      Qty   : ${p.quantity}`, `      Price : $${p.total_price}`, `      Date  : ${fmtKH(p.purchased_at)}`, '      Accounts:');
      (p.accounts || []).forEach((a) => lines.push(`        • ${formatAccount(a)}`));
      if (!(p.accounts || []).length) lines.push('        (none)');
    });
  }
  lines.push('', '='.repeat(W), '='.repeat(W));
  const buf = Buffer.from(lines.join('\n'), 'utf8');
  await tg.sendDocument(chatId, buf, `buyers_${nowKHFile()}.txt`, `📋 របាយការណ៍ទិញ — ${Object.keys(grouped).length} អ្នក​ទិញ`);
  await sendAdminSettingsMenu(ctx, chatId);
}

async function showUsersList(ctx: BotCtx, chatId: number) {
  const rows = Object.entries(ctx.db.users);
  if (!rows.length) { await tg.sendMessage(chatId, '📭 <b>មិនទាន់មានអ្នកប្រើប្រាស់ទេ។</b>', BACK_SETTINGS_KB); return; }
  const lines: string[] = [`👥 អ្នកប្រើប្រាស់សរុប: ${rows.length}`, ''];
  for (const [uid, info] of rows) {
    const full = [info.first_name, info.last_name].filter(Boolean).join(' ') || 'N/A';
    const uname = info.username ? `@${info.username}` : '—';
    lines.push(`${full}`, `   🔖 ${uname}`, `   🪪 ${uid}`, '');
  }
  const buf = Buffer.from(lines.join('\n'), 'utf8');
  await tg.sendDocument(chatId, buf, `users_${nowKHFile()}.txt`, `👥 បញ្ជីអ្នកប្រើប្រាស់ — ${rows.length} នាក់`);
  await sendAdminSettingsMenu(ctx, chatId);
}

async function sendKhpayInfo(ctx: BotCtx, chatId: number) {
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
  await tg.sendMessage(chatId, lines.join('\n'), KHPAY_SUBMENU_KB);
}

async function runBroadcast(ctx: BotCtx, adminChatId: number, bcastText: string) {
  const uids = Object.keys(ctx.db.users);
  let sent = 0, failed = 0, blocked = 0;
  for (const uidStr of uids) {
    const uid = Number(uidStr);
    const r = await tg.sendMessage(uid, bcastText);
    if (r) sent++;
    else blocked++; // gateway returned null — assume blocked/failed
    await new Promise((res) => setTimeout(res, 50));
  }
  await tg.sendMessage(
    adminChatId,
    '📢 <b>ផ្សាយ​សារ​បាន​ចប់</b>\n' +
      '━━━━━━━━━━━━━━━━━━━\n' +
      `👥 សរុប:         ${uids.length}\n` +
      `✅ ផ្ញើ​ជោគជ័យ:   ${sent}\n` +
      `⛔ បាន​ប្លុក/លុប:  ${blocked}\n` +
      `❌ បរាជ័យ:        ${failed}`,
    ADMIN_SETTINGS_KB,
  );
}

// ============= Admin button + input dispatch =============

async function dispatchAdminButton(ctx: BotCtx, chatId: number, uid: number, btn: string) {
  switch (btn) {
    case BTN_ADD_ACCOUNT:
      ctx.db.sessions[String(uid)] = { state: 'waiting_for_accounts' };
      return tg.sendMessage(chatId, '<b>បញ្ចូលគូប៉ុងសម្រាប់លក់</b>', ADD_ACCOUNT_KB);
    case BTN_DELETE_TYPE: {
      const types = Object.keys(ctx.db.accounts.account_types);
      if (!types.length) return tg.sendMessage(chatId, '⚠️ <b>មិនមានប្រភេទ គូប៉ុង ណាមួយទេ!</b>');
      const labelsMap: Record<string, string> = {};
      const rows = types.map((t) => {
        const count = ctx.db.accounts.account_types[t].length;
        const label = `${shortLabel(t)} – មានក្នុងស្តុក ${count}`;
        labelsMap[label] = t;
        return [label];
      });
      rows.push([BTN_BACK_SETTINGS]);
      ctx.db.sessions[String(uid)] = { state: 'delete_type_select', labels: labelsMap };
      return tg.sendMessage(chatId, '🗑 <b>ជ្រើសរើសប្រភេទ គូប៉ុង ដែលចង់លុប៖</b>', { keyboard: rows, resize_keyboard: true, is_persistent: true });
    }
    case BTN_STOCK:  return exportStock(ctx, chatId);
    case BTN_BUYERS: return exportBuyers(ctx, chatId);
    case BTN_USERS:  return showUsersList(ctx, chatId);
    case BTN_KHPAY:
      return tg.sendMessage(chatId, `💰 <b>Cambo API Token បច្ចុប្បន្ន៖</b>\n\n<code>${esc(ctx.CAMBO_API_TOKEN)}</code>`, KHPAY_SUBMENU_KB);
    case BTN_KHPAY_KEY_EDIT:
      ctx.db.sessions[String(uid)] = { state: 'admin_input:khpay_key' };
      return tg.sendMessage(chatId, '💰 សូមផ្ញើ <b>Cambo API Token</b> ថ្មី:\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
    case BTN_KHPAY_INFO: return sendKhpayInfo(ctx, chatId);
    case BTN_CHANNEL: {
      const cur = ctx.CHANNEL_ID || '(មិនទាន់កំណត់)';
      return tg.sendMessage(chatId, `📢 <b>Channel ID បច្ចុប្បន្ន៖</b>\n<code>${esc(String(cur))}</code>`, CHANNEL_SUBMENU_KB);
    }
    case BTN_CHANNEL_EDIT:
      ctx.db.sessions[String(uid)] = { state: 'admin_input:channel' };
      return tg.sendMessage(chatId, '📢 សូមផ្ញើ <b>Channel ID</b> ថ្មី (ឧ. <code>-1001234567890</code>):\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
    case BTN_CHANNEL_CLEAR:
      ctx.db.settings.TELEGRAM_CHANNEL_ID = '';
      ctx.CHANNEL_ID = '';
      return tg.sendMessage(chatId, '✅ បានលុប Channel ID', ADMIN_SETTINGS_KB);
    case BTN_ADMINS: {
      const extras = [...ctx.EXTRA_ADMIN_IDS].sort();
      const extrasStr = extras.length ? extras.map((x) => `• <code>${x}</code>`).join('\n') : '(គ្មាន)';
      return tg.sendMessage(chatId, `👑 <b>Admin បឋម៖</b> <code>${ctx.ADMIN_ID}</code>\n\n➕ <b>Admin បន្ថែម៖</b>\n${extrasStr}`, ADMINS_SUBMENU_KB);
    }
    case BTN_ADMIN_ADD:
      ctx.db.sessions[String(uid)] = { state: 'admin_input:admin_add' };
      return tg.sendMessage(chatId, '➕ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់បន្ថែម:', CANCEL_INPUT_KB);
    case BTN_ADMIN_REMOVE:
      ctx.db.sessions[String(uid)] = { state: 'admin_input:admin_remove' };
      return tg.sendMessage(chatId, '➖ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់ដក:', CANCEL_INPUT_KB);
    case BTN_MAINTENANCE: {
      const status = ctx.MAINTENANCE_MODE ? '🔴 បិទ' : '🟢 បើក';
      return tg.sendMessage(chatId, `🛠 <b>ស្ថានភាព Bot បច្ចុប្បន្ន៖</b> ${status}`, MAINTENANCE_SUBMENU_KB);
    }
    case BTN_MAINT_ON:
      ctx.db.settings.MAINTENANCE_MODE = 'true'; ctx.MAINTENANCE_MODE = true;
      return tg.sendMessage(chatId, '🔴 បានបិទ Bot', ADMIN_SETTINGS_KB);
    case BTN_MAINT_OFF:
      ctx.db.settings.MAINTENANCE_MODE = 'false'; ctx.MAINTENANCE_MODE = false;
      return tg.sendMessage(chatId, '🟢 បានបើក Bot', ADMIN_SETTINGS_KB);
    case BTN_BROADCAST:
      ctx.db.sessions[String(uid)] = { state: 'admin_input:broadcast' };
      return tg.sendMessage(chatId, '📢 សូមផ្ញើ​សារ​ដែល​ចង់​ផ្សាយ​ទៅ​អ្នក​ប្រើ​ប្រាស់​ទាំង​អស់៖\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>', CANCEL_INPUT_KB);
    default:
      return sendAdminSettingsMenu(ctx, chatId);
  }
}

async function handleAdminInput(ctx: BotCtx, chatId: number, uid: number, msgId: number, key: string, text: string) {
  const cancelWords = new Set(['បោះបង់', '🚫 បោះបង់', BTN_CANCEL_INPUT, BTN_BACK_SETTINGS]);
  if (cancelWords.has(text)) { delete ctx.db.sessions[String(uid)]; return sendAdminSettingsMenu(ctx, chatId); }

  if (key === 'khpay_key') {
    if (!text) return tg.sendMessage(chatId, '❌ Token មិនត្រឹមត្រូវ\n\nសូមផ្ញើ Token ត្រឹមត្រូវ (ឬចុច 🚫 បោះបង់)');
    ctx.db.settings.CAMBO_API_TOKEN = text; ctx.CAMBO_API_TOKEN = text;
    delete ctx.db.sessions[String(uid)];
    tg.deleteMessage(chatId, msgId).catch(() => {});
    return tg.sendMessage(chatId, `✅ បានប្តូរ <b>Cambo API Token</b>\n<code>${esc(text.slice(0, 12))}…${esc(text.slice(-4))}</code>`, mainKb(ctx, uid));
  }

  if (key === 'channel') {
    if (!text) return tg.sendMessage(chatId, 'សូមផ្ញើ Channel ID ថ្មី ឬ <code>off</code> ដើម្បីបិទ');
    if (['off','none','clear','delete','remove'].includes(text.toLowerCase())) {
      ctx.db.settings.TELEGRAM_CHANNEL_ID = ''; ctx.CHANNEL_ID = '';
    } else {
      ctx.db.settings.TELEGRAM_CHANNEL_ID = text; ctx.CHANNEL_ID = text;
    }
    delete ctx.db.sessions[String(uid)];
    return tg.sendMessage(chatId, `✅ បានកំណត់ Channel ID ទៅជា <code>${esc(ctx.CHANNEL_ID || '(ទទេ)')}</code>`, mainKb(ctx, uid));
  }

  if (key === 'admin_add') {
    const target = parseInt(text, 10);
    if (isNaN(target)) return tg.sendMessage(chatId, '❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)');
    if (target === ctx.ADMIN_ID) {
      delete ctx.db.sessions[String(uid)];
      return tg.sendMessage(chatId, 'ℹ️ Admin បឋមមិនអាចលុប/បន្ថែមបានទេ។', mainKb(ctx, uid));
    }
    ctx.EXTRA_ADMIN_IDS.add(target);
    ctx.db.settings.EXTRA_ADMIN_IDS = JSON.stringify([...ctx.EXTRA_ADMIN_IDS]);
    delete ctx.db.sessions[String(uid)];
    return tg.sendMessage(chatId, `✅ បានបន្ថែម <code>${target}</code> ជា admin`);
  }

  if (key === 'admin_remove') {
    const target = parseInt(text, 10);
    if (isNaN(target)) return tg.sendMessage(chatId, '❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)');
    ctx.EXTRA_ADMIN_IDS.delete(target);
    ctx.db.settings.EXTRA_ADMIN_IDS = JSON.stringify([...ctx.EXTRA_ADMIN_IDS]);
    delete ctx.db.sessions[String(uid)];
    return tg.sendMessage(chatId, `✅ បានដក <code>${target}</code> ចាក admin`);
  }

  if (key === 'broadcast') {
    ctx.db.sessions[String(uid)] = {
      state: 'broadcast_confirm',
      broadcast_message_id: msgId,
      broadcast_chat_id: chatId,
      broadcast_use_copy: true,
      broadcast_text: text,
    };
    return tg.sendMessage(chatId, `📢 <b>ព្រមព្រៀងផ្សាយ:</b>\n\n${esc(text)}\n\n<i>ផ្សាយទៅអ្នកប្រើ ${Object.keys(ctx.db.users).length} នាក់</i>`, BROADCAST_CONFIRM_KB);
  }
}

// ============= Update dispatcher =============

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; }
interface TgChat { id: number; type?: string; }
interface TgMsg { message_id: number; chat: TgChat; from?: TgUser; text?: string; caption?: string; }
interface TgCallbackQuery { id: string; data?: string; from: TgUser; message?: TgMsg; }
interface TgUpdate {
  update_id: number;
  message?: TgMsg;
  edited_message?: TgMsg;
  callback_query?: TgCallbackQuery;
  channel_post?: TgMsg;
}

export async function handleUpdate(update: TgUpdate, preDb?: BotDB): Promise<void> {
  const db = preDb ?? (await loadDB());
  const ctx = loadCtx(db);

  try {
    if (update.channel_post) {
      await handleChannelPost(ctx, update.channel_post);
    } else if (update.callback_query) {
      await handleCallback(ctx, update.callback_query);
    } else if (update.message) {
      await handleMessage(ctx, update.message);
    }
  } catch (e) {
    console.warn('[BotError]', (e as Error).message);
  }

  const savePromise = saveDB(ctx.db);
  // Run watchdog only when there is a payment-pending session — avoids
  // an extra DB roundtrip + Bakong network call on every update.
  const hasPending = Object.values(ctx.db.sessions).some((s) => s.state === 'payment_pending');
  if (hasPending) {
    runWatchdog().catch((e) => console.warn('[Watchdog] post-update:', (e as Error).message));
  }
  await savePromise;
}

async function handleMessage(ctx: BotCtx, msg: TgMsg) {
  if (!msg.from) return;
  const uid = msg.from.id;
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();
  await notifyAdminNewUser(ctx, msg.from);

  // /start
  if (text === '/start' || text.startsWith('/start ')) {
    if (ctx.MAINTENANCE_MODE && !isAdmin(ctx, uid)) {
      await tg.sendMessage(chatId, '🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>');
      return;
    }
    const sess = ctx.db.sessions[String(uid)];
    if (sess?.state === 'payment_pending') {
      await tg.sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្តើមការទិញថ្មី។');
      return;
    }
    delete ctx.db.sessions[String(uid)];
    await showAccountSelection(ctx, chatId);
    return;
  }

  if (ctx.MAINTENANCE_MODE && !isAdmin(ctx, uid)) {
    await tg.sendMessage(chatId, '🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>');
    return;
  }

  // Admin settings entry
  if (text === ADMIN_SETTINGS_BTN && isAdmin(ctx, uid)) {
    const sess = ctx.db.sessions[String(uid)] ?? {};
    if (String(sess.state || '').startsWith('admin_input:')) delete ctx.db.sessions[String(uid)];
    return sendAdminSettingsMenu(ctx, chatId);
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
        return tg.sendMessage(
          chatId,
          `⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: ${esc(typeName)}\n🔹 ចំនួន: ${count}\n🔹 តម្លៃ: $${price}</blockquote>`,
          { keyboard: [[BTN_DELETE_CONFIRM], [BTN_DELETE_CANCEL]], resize_keyboard: true, is_persistent: true },
        );
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
        return tg.sendMessage(chatId, `✅ <b>បានលុបប្រភេទ <code>${esc(typeName)}</code> ចំនួន ${count} records!</b>`, ADMIN_SETTINGS_KB);
      }
      return tg.sendMessage(chatId, '🚫 <b>បានបោះបង់ការលុប</b>', ADMIN_SETTINGS_KB);
    }

    if (state === 'broadcast_confirm') {
      const bcastText = sess.broadcast_text || '';
      delete ctx.db.sessions[String(uid)];
      if (text === BTN_BROADCAST_CONFIRM && bcastText) {
        await tg.sendMessage(chatId, '📢 កំពុង​ផ្សាយ​សារ ... សូមរង់ចាំ', ADMIN_SETTINGS_KB);
        await saveDB(ctx.db);
        await runBroadcast(ctx, chatId, bcastText);
        return;
      }
      return tg.sendMessage(chatId, '🚫 <b>បាន​បោះបង់​ការ​ផ្សាយ</b>', ADMIN_SETTINGS_KB);
    }

    if (state === 'waiting_for_accounts') {
      if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
        delete ctx.db.sessions[String(uid)];
        return sendAdminSettingsMenu(ctx, chatId);
      }
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return tg.sendMessage(chatId, '<b>អ៊ីមែលមិនត្រឹមត្រូវតាមទម្រង់</b>', ADD_ACCOUNT_KB);
      const newAccounts: Account[] = lines.map((l) => {
        if (l.includes('|')) {
          const [ph, pw] = l.split('|').map((s) => s.trim());
          return { phone: ph, password: pw };
        }
        return { code: l };
      });
      const existingTypes = Object.keys(ctx.db.accounts.account_types);
      ctx.db.sessions[String(uid)] = { state: 'waiting_for_account_type', accounts: newAccounts };
      const typeRows = [...existingTypes.map((t) => [t]), [BTN_BACK_SETTINGS]];
      return tg.sendMessage(
        chatId,
        `<b>បានបញ្ចូល គូប៉ុង ចំនួន ${newAccounts.length}\n\nសូមជ្រើសរើស ឬបញ្ចូលប្រភេទ គូប៉ុង៖</b>`,
        { keyboard: typeRows, resize_keyboard: true, is_persistent: true },
      );
    }

    if (state === 'waiting_for_account_type') {
      if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
        delete ctx.db.sessions[String(uid)];
        return sendAdminSettingsMenu(ctx, chatId);
      }
      const existingPrice = ctx.db.accounts.prices[text];
      ctx.db.sessions[String(uid)] = { ...sess, state: 'waiting_for_price', account_type: text };
      if (existingPrice != null) {
        return tg.sendMessage(chatId, `<b>ប្រភេទ <code>${esc(text)}</code> មានស្រាប់ ដែលមានតម្លៃ ${existingPrice}$\n\nតម្លៃត្រូវតែដូចគ្នា (${existingPrice}$) ដើម្បីបន្ថែម គូប៉ុង</b>`, ADD_ACCOUNT_KB);
      }
      return tg.sendMessage(chatId, `<b>សូមដាក់តម្លៃក្នុងប្រភេទ គូប៉ុង ${esc(text)}</b>`, ADD_ACCOUNT_KB);
    }

    if (state === 'waiting_for_price') {
      if (text === BTN_BACK_SETTINGS || text === BTN_CANCEL_INPUT) {
        delete ctx.db.sessions[String(uid)];
        return sendAdminSettingsMenu(ctx, chatId);
      }
      const price = parseFloat(text.replace('$', '').trim());
      if (isNaN(price) || price < 0) return tg.sendMessage(chatId, 'តម្លៃមិនត្រឹមត្រូវ។ សូមបញ្ចូលតម្លៃជាលេខ (ឧ: 5.99)');
      const accountType = sess.account_type!;
      const accsToAdd = sess.accounts ?? [];
      const existingPrice = ctx.db.accounts.prices[accountType];
      if (existingPrice != null && Math.round(existingPrice * 10000) !== Math.round(price * 10000)) {
        return tg.sendMessage(
          chatId,
          `❌ <b>មិនអាចបញ្ចូលបាន!</b>\n\nប្រភេទ <code>${esc(accountType)}</code> មានតម្លៃ <b>${existingPrice}$</b> ស្រាប់។\nតម្លៃ <b>${price}$</b> មិនដូចគ្នា។ សូមប្រើ <b>${existingPrice}$</b>`,
          ADD_ACCOUNT_KB,
        );
      }
      const allExisting = new Set(
        Object.values(ctx.db.accounts.account_types).flat().map((a) => (a.code || a.email || a.phone || '').toLowerCase()).filter(Boolean),
      );
      const toAdd = accsToAdd.filter((a) => !allExisting.has((a.code || a.email || a.phone || '').toLowerCase()));
      const dupes = accsToAdd.length - toAdd.length;
      if (!ctx.db.accounts.account_types[accountType]) ctx.db.accounts.account_types[accountType] = [];
      ctx.db.accounts.account_types[accountType].push(...toAdd);
      ctx.db.accounts.prices[accountType] = Math.round(price * 10000) / 10000;
      delete ctx.db.sessions[String(uid)];
      await tg.sendMessage(chatId, `✅ <b>បានបញ្ចូល គូប៉ុង ដោយជោគជ័យ</b>\n\n<blockquote>🔹 ចំនួន: ${toAdd.length}\n🔹 ប្រភេទ: ${esc(accountType)}\n🔹 តម្លៃ: ${price}$</blockquote>` + (dupes ? `\n\n⚠️ ដដែល (រំលង): ${dupes}` : ''));
      return sendAdminSettingsMenu(ctx, chatId);
    }

    if (ADMIN_BUTTON_LABELS.has(text)) return dispatchAdminButton(ctx, chatId, uid, text);
  }

  if (text === '💵 ទិញគូប៉ុង') {
    const sess = ctx.db.sessions[String(uid)];
    if (sess?.state === 'payment_pending') {
      return tg.sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្ដើមការទិញថ្មី។');
    }
    delete ctx.db.sessions[String(uid)];
    return showAccountSelection(ctx, chatId);
  }

  if (ctx.db.sessions[String(uid)]?.state === 'payment_pending') {
    return tg.sendMessage(chatId, '⏳ <b>សូមបញ្ចប់ការទូទាត់ QR ជាមុនសិន</b>\nឬចុច <b>🚫 បោះបង់</b> ដើម្បីបោះបង់', CHECK_PAYMENT_INLINE);
  }
  // Use MAIN_KB to give non-admin users the "💵 ទិញគូប៉ុង" button on first interaction
  if (!isAdmin(ctx, uid)) await tg.sendMessage(chatId, ' ', MAIN_KB).catch(() => {});
  await showAccountSelection(ctx, chatId);
}

async function handleCallback(ctx: BotCtx, cb: TgCallbackQuery) {
  const data = cb.data ?? '';
  const uid = cb.from.id;
  const chatId = cb.message?.chat?.id ?? uid;
  const msgId = cb.message?.message_id;
  await notifyAdminNewUser(ctx, cb.from);

  if (data.startsWith('buy:')) {
    const at = typeFromCbId(ctx, data.slice(4));
    if (!at) return tg.answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ។', true);
    const sess = ctx.db.sessions[String(uid)];
    if (sess?.state === 'payment_pending') return tg.answerCallbackQuery(cb.id, 'សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន', true);
    await tg.answerCallbackQuery(cb.id);
    const pool = ctx.db.accounts.account_types[at] ?? [];
    const price = ctx.db.accounts.prices[at] ?? 0;
    if (pool.length <= 0) return tg.sendMessage(chatId, `<i>សូមអភ័យទោស គូប៉ុង ${esc(at)} អស់ពីស្តុក 🪤</i>`);
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
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < qtyBtns.length; i += 5) rows.push(qtyBtns.slice(i, i + 5));
    rows.push([{ text: '🚫 បោះបង់', callback_data: 'cancel_buy' }]);
    await tg.sendMessage(chatId, '<b>សូមជ្រើសរើសចំនួនដែលចង់ទិញ៖</b>', { inline_keyboard: rows });
    if (msgId) tg.deleteMessage(chatId, msgId).catch(() => {});
    return;
  }

  if (data.startsWith('qty:')) {
    const parts = data.split(':');
    let at: string | null = null, qty = 0;
    if (parts.length === 3) { at = typeFromCbId(ctx, parts[1]); qty = parseInt(parts[2], 10); }
    else if (parts.length === 2) qty = parseInt(parts[1], 10);
    if (!qty || qty < 1) return tg.answerCallbackQuery(cb.id);
    const sess = ctx.db.sessions[String(uid)];
    if (!sess || sess.state !== 'waiting_for_quantity') return tg.answerCallbackQuery(cb.id);
    if (at && sess.account_type !== at) return tg.answerCallbackQuery(cb.id, 'ប្រភេទផ្លាស់ប្ដូរ — ចាប់ផ្ដើមម្ដងទៀត', true);
    if (qty > (sess.available_count ?? 0)) return tg.answerCallbackQuery(cb.id, `សុំទោស! មានត្រឹមតែ ${sess.available_count} នៅក្នុងស្តុក`, true);
    sess.quantity = qty;
    sess.total_price = Math.round(qty * (sess.price ?? 0) * 100) / 100;
    if (msgId) tg.deleteMessage(chatId, msgId).catch(() => {});
    await startPaymentForSession(ctx, chatId, uid, sess, cb.id);
    return;
  }

  if (data === 'cancel_buy') {
    await tg.answerCallbackQuery(cb.id);
    const sess = ctx.db.sessions[String(uid)];
    if (sess?.reserved_accounts?.length && sess.account_type) {
      ctx.db.accounts.account_types[sess.account_type] = [...sess.reserved_accounts, ...(ctx.db.accounts.account_types[sess.account_type] ?? [])];
    }
    delete ctx.db.sessions[String(uid)];
    if (msgId) tg.deleteMessage(chatId, msgId).catch(() => {});
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
          await tg.answerCallbackQuery(cb.id, '✅ បានទទួលការបង់ប្រាក់!');
          await deliverAccounts(ctx, chatId, uid, sess!, pd);
          return;
        }
      } catch { /* ignore */ }
    }
    await tg.answerCallbackQuery(cb.id);
    if (sess) {
      const { account_type, reserved_accounts = [] } = sess;
      if (reserved_accounts.length && account_type) {
        ctx.db.accounts.account_types[account_type] = [...reserved_accounts, ...(ctx.db.accounts.account_types[account_type] ?? [])];
      }
      for (const k of ['photo_message_id', 'qr_message_id'] as const) {
        const mid = sess[k];
        if (mid) tg.deleteMessage(chatId, mid).catch(() => {});
      }
      delete ctx.db.sessions[String(uid)];
    }
    await showAccountSelection(ctx, chatId);
    return;
  }

  if (data === 'check_payment') {
    const sess = ctx.db.sessions[String(uid)];
    const txnId = sess?.transaction_id;
    if (!txnId) return tg.answerCallbackQuery(cb.id, '⚠️ រកមិនឃើញការទូទាត់', true);
    await tg.answerCallbackQuery(cb.id, '⏳ កំពុងពិនិត្យ…');
    try {
      const { paid, data: pd } = await checkKhpayStatus(ctx.CAMBO_API_TOKEN, txnId, sess?.md5 ?? null);
      if (paid) await deliverAccounts(ctx, chatId, uid, sess!, pd);
      else await tg.answerCallbackQuery(cb.id, '❌ មិនទាន់បង់ប្រាក់ទេ', true);
    } catch (e) {
      await tg.answerCallbackQuery(cb.id, '❌ មានបញ្ហា: ' + (e as Error).message, true);
    }
    return;
  }

  if (data.startsWith('dts:') && isAdmin(ctx, uid)) {
    const typeName = typeFromCbId(ctx, data.slice(4)) || data.slice(4);
    if (!ctx.db.accounts.account_types[typeName]) return tg.answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ!', true);
    await tg.answerCallbackQuery(cb.id);
    const count = ctx.db.accounts.account_types[typeName].length;
    const price = ctx.db.accounts.prices[typeName] ?? 0;
    await tg.sendMessage(
      chatId,
      `⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: ${esc(typeName)}\n🔹 ចំនួន: ${count}\n🔹 តម្លៃ: $${price}</blockquote>`,
      { inline_keyboard: [[
        { text: '✅ បញ្ជាក់លុប', callback_data: `dtc:${typeCallbackId(typeName)}` },
        { text: '🚫 បោះបង់', callback_data: 'dtcancel' },
      ]] },
    );
    return;
  }

  if (data.startsWith('dtc:') && isAdmin(ctx, uid)) {
    const typeName = typeFromCbId(ctx, data.slice(4)) || data.slice(4);
    if (!ctx.db.accounts.account_types[typeName]) return tg.answerCallbackQuery(cb.id, 'ប្រភេទនេះមិនមានទៀតហើយ!', true);
    await tg.answerCallbackQuery(cb.id);
    const count = (ctx.db.accounts.account_types[typeName] ?? []).length;
    delete ctx.db.accounts.account_types[typeName];
    delete ctx.db.accounts.prices[typeName];
    if (msgId) tg.deleteMessage(chatId, msgId).catch(() => {});
    await tg.sendMessage(chatId, `✅ <b>បានលុប <code>${esc(typeName)}</code> ចំនួន ${count} records!</b>`);
    return;
  }

  if (data === 'dtcancel' && isAdmin(ctx, uid)) {
    await tg.answerCallbackQuery(cb.id);
    if (msgId) tg.deleteMessage(chatId, msgId).catch(() => {});
    await tg.sendMessage(chatId, '🚫 <b>បានបោះបង់ការលុប</b>');
    return;
  }

  await tg.answerCallbackQuery(cb.id);
}

async function handleChannelPost(ctx: BotCtx, post: TgMsg) {
  try {
    const text = post.text || post.caption || '';
    if (!text) return;
    if (!text.includes('noreply@e-gets.com') && !text.includes('e-gets.com')) return;
    const emailMatch = text.match(/📧[^\n:]*:\s*([^\s\n]+)/);
    if (!emailMatch) { console.log('[EGets] No email extracted'); return; }
    const email = emailMatch[1].trim();
    const codeMatch = text.match(/^\s*(\d{4,8})\s*$/m);
    if (!codeMatch) { console.log(`[EGets] No code for ${email}`); return; }
    const code = codeMatch[1].trim();
    const matched = ctx.db.purchases.filter((p) =>
      (p.accounts || []).some((a) => (a.email || a.code || '').trim().toLowerCase() === email.toLowerCase()),
    );
    if (!matched.length) { console.log(`[EGets] no buyer for ${email}`); return; }
    const sent = new Set<number>();
    for (const p of matched) {
      if (sent.has(p.user_id)) continue;
      sent.add(p.user_id);
      const msg = `📩 <b>លេខកូដផ្ទៀងផ្ទាត់ E-GetS</b>\n\n<code>${esc(email)}</code>\n\n<code>${code}</code>`;
      await tg.sendMessage(p.user_id, msg).catch(() => {});
    }
  } catch (e) {
    console.warn('[EGets] channel_post error:', (e as Error).message);
  }
}