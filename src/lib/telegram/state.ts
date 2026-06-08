// Bot state — single JSON document stored in public.bot_state (key = 'db')
import { supabaseAdmin } from '@/integrations/supabase/client.server';

export interface Account {
  email?: string;
  phone?: string;
  password?: string;
  code?: string;
}

export interface AccountsData {
  account_types: Record<string, Account[]>;
  prices: Record<string, number>;
}

export interface Session {
  state?: string;
  account_type?: string;
  quantity?: number;
  price?: number;
  total_price?: number;
  available_count?: number;
  reserved_accounts?: Account[];
  transaction_id?: string;
  md5?: string | null;
  qr_sent_at?: number;
  photo_message_id?: number;
  qr_message_id?: number;
  started_at?: number;
  accounts?: Account[];
  type_name?: string;
  labels?: Record<string, string>;
  broadcast_text?: string;
  broadcast_message_id?: number;
  broadcast_chat_id?: number;
  broadcast_use_copy?: boolean;
}

export interface KnownUser {
  first_name: string;
  last_name: string;
  username: string;
  first_seen: string;
}

export interface Purchase {
  user_id: number;
  account_type: string;
  quantity: number;
  total_price: number;
  accounts: Account[];
  purchased_at: string;
}

export interface BotDB {
  accounts: AccountsData;
  sessions: Record<string, Session>;
  settings: Record<string, string>;
  users: Record<string, KnownUser>;
  purchases: Purchase[];
}

const EMPTY: BotDB = {
  accounts: { account_types: {}, prices: {} },
  sessions: {},
  settings: {},
  users: {},
  purchases: [],
};

export async function loadDB(): Promise<BotDB> {
  const { data, error } = await supabaseAdmin
    .from('bot_state')
    .select('value')
    .eq('key', 'db')
    .maybeSingle();
  if (error) {
    console.warn('[state] loadDB error:', error.message);
    return structuredClone(EMPTY);
  }
  if (!data) return structuredClone(EMPTY);
  const v = (data.value ?? {}) as Partial<BotDB>;
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

export async function saveDB(db: BotDB): Promise<void> {
  const { error } = await supabaseAdmin
    .from('bot_state')
    .upsert({ key: 'db', value: db as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.warn('[state] saveDB error:', error.message);
}

// Idempotency: returns true if this update_id is new (and was inserted), false if already processed.
export async function markUpdateProcessed(updateId: number): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('telegram_updates')
    .insert({ update_id: updateId });
  if (error) {
    // duplicate key — already processed
    return false;
  }
  return true;
}