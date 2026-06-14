// Bot state — single JSON document stored in public.bot_state (key = 'db')
import { query } from '@/lib/db.server';

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
  try {
    const result = await query<{ value: unknown }>(
      "SELECT value FROM bot_state WHERE key = 'db' LIMIT 1",
    );
    if (!result.rows.length) return structuredClone(EMPTY);
    const v = (result.rows[0].value ?? {}) as Partial<BotDB>;
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
  } catch (e) {
    console.warn('[state] loadDB error:', (e as Error).message);
    return structuredClone(EMPTY);
  }
}

export async function saveDB(db: BotDB): Promise<void> {
  try {
    await query(
      `INSERT INTO bot_state (key, value, updated_at)
       VALUES ('db', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(db)],
    );
  } catch (e) {
    console.warn('[state] saveDB error:', (e as Error).message);
  }
}

// Idempotency: returns true if this update_id is new (and was inserted), false if already processed.
export async function markUpdateProcessed(updateId: number): Promise<boolean> {
  try {
    await query(
      'INSERT INTO telegram_updates (update_id) VALUES ($1)',
      [updateId],
    );
    return true;
  } catch {
    // duplicate key — already processed
    return false;
  }
}
