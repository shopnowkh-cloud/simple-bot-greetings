import type { ReplyMarkup } from './api';

export const BTN_ADD_ACCOUNT       = '➕ បន្ថែម គូប៉ុង';
export const BTN_DELETE_TYPE       = '🗑 លុបប្រភេទ';
export const BTN_STOCK             = '📦 ស្តុក គូប៉ុង';
export const BTN_USERS             = '👥 អ្នកប្រើប្រាស់';
export const BTN_BUYERS            = '📋 របាយការណ៍ទិញ';
export const BTN_KHPAY             = '💰 KhPay API';
export const BTN_CHANNEL           = '📢 Channel ID';
export const BTN_ADMINS            = '👑 គ្រប់គ្រង Admin';
export const BTN_MAINTENANCE       = '🛠 Maintenance Mode';
export const BTN_BROADCAST         = '📢 ផ្សាយព័ត៌មាន';
export const BTN_BACK_SETTINGS     = '⬅️';
export const BTN_KHPAY_KEY_EDIT    = '✏️ ប្តូរ KhPay API Key';
export const BTN_KHPAY_INFO        = '📊 ព័ត៌មាន KhPay';
export const BTN_CHANNEL_EDIT      = '✏️ ប្តូរ Channel ID';
export const BTN_CHANNEL_CLEAR     = '🗑 លុប Channel ID';
export const BTN_ADMIN_ADD         = '➕ បន្ថែម Admin';
export const BTN_ADMIN_REMOVE      = '➖ ដក Admin';
export const BTN_MAINT_ON          = '🔴 បិទ Bot';
export const BTN_MAINT_OFF         = '🟢 បើក Bot';
export const BTN_CANCEL_INPUT      = '🚫 បោះបង់';
export const BTN_DELETE_CONFIRM    = '✅ បញ្ជាក់លុប';
export const BTN_DELETE_CANCEL     = '🚫 បោះបង់ការលុប';
export const BTN_BROADCAST_CONFIRM = '✅ បញ្ជាក់ផ្សាយ';
export const BTN_BROADCAST_CANCEL  = '🚫 បោះបង់ការផ្សាយ';
export const ADMIN_SETTINGS_BTN    = '⚙️កំណត់';

export const ADMIN_BUTTON_LABELS = new Set<string>([
  BTN_ADD_ACCOUNT, BTN_DELETE_TYPE, BTN_STOCK, BTN_USERS, BTN_BUYERS,
  BTN_KHPAY, BTN_CHANNEL, BTN_ADMINS, BTN_MAINTENANCE, BTN_BROADCAST,
  BTN_BACK_SETTINGS, BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO,
  BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR, BTN_ADMIN_ADD, BTN_ADMIN_REMOVE,
  BTN_MAINT_ON, BTN_MAINT_OFF, BTN_CANCEL_INPUT,
  BTN_DELETE_CONFIRM, BTN_DELETE_CANCEL, BTN_BROADCAST_CONFIRM, BTN_BROADCAST_CANCEL,
  ADMIN_SETTINGS_BTN,
]);

const kb = (rows: string[][]): ReplyMarkup => ({ keyboard: rows, resize_keyboard: true, is_persistent: true });

export const MAIN_KB: ReplyMarkup            = kb([['💵 ទិញគូប៉ុង']]);
export const ADMIN_KB: ReplyMarkup           = kb([[ADMIN_SETTINGS_BTN]]);
export const ADMIN_SETTINGS_KB: ReplyMarkup  = kb([
  [BTN_ADD_ACCOUNT, BTN_DELETE_TYPE],
  [BTN_STOCK,       BTN_BUYERS],
  [BTN_USERS,       BTN_KHPAY],
  [BTN_CHANNEL,     BTN_ADMINS],
  [BTN_BROADCAST,   BTN_MAINTENANCE],
]);
export const CANCEL_INPUT_KB: ReplyMarkup    = kb([[BTN_CANCEL_INPUT]]);
export const ADD_ACCOUNT_KB: ReplyMarkup     = kb([[BTN_BACK_SETTINGS]]);
export const BACK_SETTINGS_KB: ReplyMarkup   = kb([[BTN_BACK_SETTINGS]]);
export const KHPAY_SUBMENU_KB: ReplyMarkup   = kb([[BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO], [BTN_BACK_SETTINGS]]);
export const CHANNEL_SUBMENU_KB: ReplyMarkup = kb([[BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR], [BTN_BACK_SETTINGS]]);
export const ADMINS_SUBMENU_KB: ReplyMarkup  = kb([[BTN_ADMIN_ADD, BTN_ADMIN_REMOVE], [BTN_BACK_SETTINGS]]);
export const MAINTENANCE_SUBMENU_KB: ReplyMarkup = kb([[BTN_MAINT_ON, BTN_MAINT_OFF], [BTN_BACK_SETTINGS]]);
export const BROADCAST_CONFIRM_KB: ReplyMarkup   = kb([[BTN_BROADCAST_CONFIRM], [BTN_BROADCAST_CANCEL]]);
export const REMOVE_KB: ReplyMarkup = { remove_keyboard: true };

export const CHECK_PAYMENT_INLINE: ReplyMarkup = {
  inline_keyboard: [[
    { text: '🚫 បោះបង់', callback_data: 'cancel_purchase' },
    { text: '✅ បានបង់ប្រាក់', callback_data: 'check_payment' },
  ]],
};

export const PAYMENT_TIMEOUT_SEC = 60;

// Helpers
export const esc = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KH_TZ = 'Asia/Phnom_Penh';
export const nowKH = () =>
  new Date().toLocaleString('sv-SE', { timeZone: KH_TZ }).replace('T', ' ') + ' +07';
export const nowKHFile = () =>
  new Date().toLocaleString('sv-SE', { timeZone: KH_TZ }).replace(/[-: ]/g, '').slice(0, 14);
export const fmtKH = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: KH_TZ }).replace('T', ' ') + ' +07' : '—';

export const shortLabel = (t: string, n = 36) => {
  const c = t.trim();
  return c.length <= n ? c : c.slice(0, n - 1) + '…';
};

import { createHash } from 'crypto';
export const typeCallbackId = (at: string) =>
  createHash('sha1').update(at).digest('hex').slice(0, 12);

export function formatAccount(acc: unknown): string {
  if (typeof acc === 'string') return acc;
  const a = acc as { email?: string; phone?: string; password?: string; code?: string };
  if (a.email) return a.email;
  if (a.phone) return `${a.phone} | ${a.password || ''}`;
  if (a.code) return a.code;
  return JSON.stringify(acc);
}