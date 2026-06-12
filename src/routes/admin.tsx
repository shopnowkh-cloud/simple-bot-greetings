import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useServerFn } from '@tanstack/react-start';
import {
  getDashboard, addCoupons, deleteCouponType, deleteOneCoupon, listCoupons,
  updateSettings, manageAdmin, broadcastMessage,
} from '@/lib/admin/dashboard.functions';
import { z } from 'zod';

const STORAGE_KEY = 'admin_dashboard_token';

const searchSchema = z.object({ token: z.string().optional() });

export const Route = createFileRoute('/admin')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: 'Admin Dashboard' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: AdminPage,
});

type Tab = 'stats' | 'users' | 'purchases' | 'stock' | 'settings';

function AdminPage() {
  const search = useSearch({ from: '/admin' });
  const [token, setToken] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');

  useEffect(() => {
    if (search.token) {
      localStorage.setItem(STORAGE_KEY, search.token);
      setToken(search.token);
      // strip token from URL
      window.history.replaceState({}, '', '/admin');
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setToken(stored);
    }
  }, [search.token]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-bold">🔐 Admin Login</h1>
          <p className="text-sm text-slate-600">
            Open your bot in Telegram and send <code className="bg-slate-100 px-1 rounded">/admin</code> — you'll get a magic link.
          </p>
          <p className="text-xs text-slate-500">ឬ​បិទភ្ជាប់ token ដោយ​ដៃ៖</p>
          <input
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="paste token"
          />
          <button
            onClick={() => {
              if (manualToken.trim()) {
                localStorage.setItem(STORAGE_KEY, manualToken.trim());
                setToken(manualToken.trim());
              }
            }}
            className="w-full bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-medium"
          >
            ចូល
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard token={token} onLogout={() => { localStorage.removeItem(STORAGE_KEY); setToken(null); }} />;
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const get = useServerFn(getDashboard);
  const [data, setData] = useState<Awaited<ReturnType<typeof getDashboard>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stats');
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await get({ data: { token } });
      setData(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [get, token]);

  useEffect(() => { reload(); }, [reload]);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow p-6 space-y-3 max-w-md w-full">
          <h2 className="font-bold text-red-600">⚠️ {err}</h2>
          <button onClick={onLogout} className="w-full bg-slate-900 text-white rounded-lg px-3 py-2 text-sm">Logout</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-10 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Admin Dashboard</h1>
          <p className="text-[11px] text-slate-300">ID {data.me.telegramId}{data.me.isPrimary ? ' • primary' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reload} disabled={loading} className="text-xs bg-slate-700 px-2 py-1 rounded">{loading ? '...' : '↻'}</button>
          <button onClick={onLogout} className="text-xs bg-red-600 px-2 py-1 rounded">Logout</button>
        </div>
      </header>

      <nav className="flex bg-white border-b sticky top-[60px] z-10 overflow-x-auto">
        {(['stats','stock','purchases','users','settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-xs font-medium whitespace-nowrap ${tab === t ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'}`}
          >
            {t === 'stats' ? '📊 ស្ថិតិ' :
             t === 'stock' ? '📦 ស្តុក' :
             t === 'purchases' ? '🧾 ការទិញ' :
             t === 'users' ? '👥 អ្នកប្រើ' : '⚙️ កំណត់'}
          </button>
        ))}
      </nav>

      <main className="p-4">
        {tab === 'stats' && <StatsTab data={data} />}
        {tab === 'stock' && <StockTab token={token} stock={data.stock} onChange={reload} />}
        {tab === 'purchases' && <PurchasesTab purchases={data.purchases} />}
        {tab === 'users' && <UsersTab users={data.users} />}
        {tab === 'settings' && <SettingsTab token={token} data={data} onChange={reload} />}
      </main>
    </div>
  );
}

function StatsTab({ data }: { data: NonNullable<Awaited<ReturnType<typeof getDashboard>>> }) {
  const s = data.stats;
  const cards = [
    { label: 'ចំណូលសរុប', v: `$${s.totalRevenue.toFixed(2)}` },
    { label: 'ថ្ងៃនេះ',   v: `$${s.revToday.toFixed(2)}` },
    { label: '៧ ថ្ងៃ',    v: `$${s.revWeek.toFixed(2)}` },
    { label: '៣០ ថ្ងៃ',   v: `$${s.revMonth.toFixed(2)}` },
    { label: 'លក់ចេញ',   v: `${s.totalSold}` },
    { label: 'ការទិញ',   v: `${s.purchaseCount}` },
    { label: 'អ្នកប្រើ',  v: `${s.userCount}` },
    { label: 'ស្តុក​នៅ​សល់', v: `${s.stockTotal}` },
    { label: 'រង់ចាំបង់', v: `${s.pendingSessions}` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl p-3 shadow-sm">
          <p className="text-[11px] text-slate-500">{c.label}</p>
          <p className="text-lg font-bold text-slate-900 mt-1">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

function StockTab({ token, stock, onChange }: { token: string; stock: { type: string; count: number; price: number }[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('');
  const [price, setPrice] = useState('');
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const add = useServerFn(addCoupons);
  const del = useServerFn(deleteCouponType);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await add({ data: { token, type, price: parseFloat(price), rawText: raw } });
      setMsg(`✅ បាន​បន្ថែម ${r.added} (ដដែល ${r.duplicates})`);
      setType(''); setPrice(''); setRaw(''); setAdding(false);
      onChange();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={() => setAdding(!adding)}
        className="w-full bg-slate-900 text-white rounded-xl py-2.5 text-sm font-medium"
      >
        {adding ? '× បិទ' : '➕ បន្ថែម​គូប៉ុង'}
      </button>
      {adding && (
        <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
          <input value={type} onChange={(e) => setType(e.target.value)} placeholder="ប្រភេទ (e.g. Netflix)" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="តម្លៃ​មួយ ($)" type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'មួយ​ជួរ​មួយ​គូប៉ុង\nឧ.  code123\nឬ  phone|password'} rows={6} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
          <button onClick={submit} disabled={busy} className="w-full bg-emerald-600 text-white rounded-lg py-2 text-sm">{busy ? 'រង់ចាំ…' : 'រក្សា​ទុក'}</button>
          {msg && <p className="text-xs text-center">{msg}</p>}
        </div>
      )}
      <div className="space-y-2">
        {stock.length === 0 && <p className="text-center text-sm text-slate-500 py-8">មិន​មាន​ស្តុក</p>}
        {stock.map((s) => (
          <StockRow key={s.type} item={s} token={token} onDelete={async () => {
            if (!confirm(`លុប​ប្រភេទ "${s.type}" (${s.count} គូប៉ុង)?`)) return;
            await del({ data: { token, type: s.type } });
            onChange();
          }} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

function StockRow({ item, token, onDelete, onChange }: { item: { type: string; count: number; price: number }; token: string; onDelete: () => void; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ code?: string; email?: string; phone?: string; password?: string }[] | null>(null);
  const list = useServerFn(listCoupons);
  const delOne = useServerFn(deleteOneCoupon);

  const toggle = async () => {
    if (!open) {
      const r = await list({ data: { token, type: item.type } });
      setItems(r.items);
    }
    setOpen(!open);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-3">
        <button onClick={toggle} className="flex-1 text-left">
          <p className="font-semibold text-sm">{item.type}</p>
          <p className="text-[11px] text-slate-500">${item.price} · {item.count} នៅសល់</p>
        </button>
        <button onClick={onDelete} className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded">លុប</button>
      </div>
      {open && items && (
        <div className="border-t bg-slate-50 max-h-72 overflow-y-auto">
          {items.length === 0 && <p className="p-3 text-center text-xs text-slate-500">អស់ស្តុក</p>}
          {items.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs border-b border-slate-200 last:border-0">
              <code className="flex-1 truncate">{a.code || a.email || (a.phone ? `${a.phone}|${a.password ?? ''}` : '')}</code>
              <button
                onClick={async () => {
                  if (!confirm('លុប​គូប៉ុង​នេះ?')) return;
                  await delOne({ data: { token, type: item.type, index: i } });
                  const r = await list({ data: { token, type: item.type } });
                  setItems(r.items);
                  onChange();
                }}
                className="text-red-600 text-[11px]"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PurchasesTab({ purchases }: { purchases: NonNullable<Awaited<ReturnType<typeof getDashboard>>>['purchases'] }) {
  if (!purchases.length) return <p className="text-center text-sm text-slate-500 py-8">មិន​មាន​ការទិញ</p>;
  return (
    <div className="space-y-2">
      {purchases.map((p, i) => (
        <div key={i} className="bg-white rounded-xl p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{p.account_type} × {p.quantity}</p>
            <p className="text-sm font-bold text-emerald-600">${p.total_price}</p>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">User {p.user_id} · {new Date(p.purchased_at).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

function UsersTab({ users }: { users: NonNullable<Awaited<ReturnType<typeof getDashboard>>>['users'] }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return users;
    return users.filter((u) =>
      String(u.telegram_id).includes(s) ||
      (u.first_name || '').toLowerCase().includes(s) ||
      (u.last_name || '').toLowerCase().includes(s) ||
      (u.username || '').toLowerCase().includes(s),
    );
  }, [users, q]);
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ស្វែងរក" className="w-full border rounded-lg px-3 py-2 text-sm" />
      {filtered.map((u) => (
        <div key={u.telegram_id} className="bg-white rounded-xl p-3 shadow-sm">
          <p className="text-sm font-semibold">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)'}</p>
          <p className="text-[11px] text-slate-500">{u.username ? `@${u.username}` : '—'} · ID {u.telegram_id}</p>
          <p className="text-[10px] text-slate-400">{u.first_seen ? new Date(u.first_seen).toLocaleString() : ''}</p>
        </div>
      ))}
    </div>
  );
}

function SettingsTab({ token, data, onChange }: { token: string; data: NonNullable<Awaited<ReturnType<typeof getDashboard>>>; onChange: () => void }) {
  const [cambo, setCambo] = useState(data.settings.CAMBO_API_TOKEN);
  const [channel, setChannel] = useState(data.settings.TELEGRAM_CHANNEL_ID);
  const [maint, setMaint] = useState(data.settings.MAINTENANCE_MODE);
  const [bcast, setBcast] = useState('');
  const [newAdmin, setNewAdmin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const upd = useServerFn(updateSettings);
  const man = useServerFn(manageAdmin);
  const bc = useServerFn(broadcastMessage);

  let extras: number[] = [];
  try { extras = JSON.parse(data.settings.EXTRA_ADMIN_IDS || '[]'); } catch { /* ignore */ }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">CAMBO API TOKEN</p>
        <input value={cambo} onChange={(e) => setCambo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
        <p className="text-xs font-semibold text-slate-500 mt-3">CHANNEL ID</p>
        <input value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={maint} onChange={(e) => setMaint(e.target.checked)} />
          🛠 Maintenance Mode (បិទ Bot)
        </label>
        <button
          onClick={async () => {
            setMsg(null);
            try {
              await upd({ data: { token, cambo, channel, maintenance: maint } });
              setMsg('✅ បាន​រក្សា​ទុក'); onChange();
            } catch (e) { setMsg(`❌ ${(e as Error).message}`); }
          }}
          className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm"
        >រក្សា​ទុក</button>
        {msg && <p className="text-xs text-center">{msg}</p>}
      </div>

      {data.me.isPrimary && (
        <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">👑 ADMINS បន្ថែម</p>
          {extras.length === 0 && <p className="text-xs text-slate-400">(គ្មាន)</p>}
          {extras.map((id) => (
            <div key={id} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg">
              <code className="text-xs">{id}</code>
              <button
                onClick={async () => {
                  await man({ data: { token, action: 'remove', telegramId: id } });
                  onChange();
                }}
                className="text-xs text-red-600"
              >ដក</button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder="Telegram ID" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button
              onClick={async () => {
                const n = parseInt(newAdmin, 10);
                if (!n) return;
                await man({ data: { token, action: 'add', telegramId: n } });
                setNewAdmin('');
                onChange();
              }}
              className="bg-emerald-600 text-white px-3 rounded-lg text-sm"
            >បន្ថែម</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-4 space-y-2 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">📢 ផ្សាយព័ត៌មាន</p>
        <textarea value={bcast} onChange={(e) => setBcast(e.target.value)} rows={4} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="សារ​ដែល​ចង់​ផ្សាយ…" />
        <button
          onClick={async () => {
            if (!bcast.trim()) return;
            if (!confirm(`ផ្ញើ​សារ​ទៅ ${data.stats.userCount} នាក់?`)) return;
            const r = await bc({ data: { token, text: bcast } });
            alert(`បាន​ផ្ញើ ${r.sent}/${r.total} · បរាជ័យ ${r.failed}`);
            setBcast('');
          }}
          className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm"
        >ផ្ញើ</button>
      </div>
    </div>
  );
}