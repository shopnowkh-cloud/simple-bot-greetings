import QRCode from 'qrcode';

const CAMBO_BASE = 'https://bakong.cambo-kh.com/api/v1';

async function camboRequest(
  token: string,
  params: Record<string, string | number>,
  opts: { timeoutMs?: number; retries?: number } = {},
) {
  const qp = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_token: token });
  const url = `${CAMBO_BASE}/?${qp.toString()}`;
  const timeoutMs = opts.timeoutMs ?? 25000;
  const retries = opts.retries ?? 2;
  let lastErr = '';
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { success: false, error: text }; }
    } catch (e) {
      lastErr = (e as Error).message;
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  return { success: false, error: lastErr || 'request failed' };
}

async function generatePlainQR(qr_string: string): Promise<Buffer> {
  return QRCode.toBuffer(qr_string, {
    errorCorrectionLevel: 'M',
    width: 400,
    margin: 3,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export interface KhpayCreateResult {
  imgBuffer: Buffer | null;
  transaction_id: string | null;
  md5?: string | null;
  expires_in?: number;
  error: string | null;
}

export async function createKhpayPayment(token: string, amount: number): Promise<KhpayCreateResult> {
  try {
    const res = await camboRequest(token, { type: 'generate_qr', amount }, { timeoutMs: 25000, retries: 2 });
    if (res.status !== 'success' || !res.data) {
      return { imgBuffer: null, transaction_id: null, error: res.message || res.error || 'API error' };
    }
    const d = res.data;
    const md5: string | null = d.md5 || null;
    const qr_string: string = d.qr || '';
    const imgUrl: string | null = d.Url_qr_code || null;
    let imgBuffer: Buffer | null = null;
    // Prefer locally-generated QR (instant, no extra network hop).
    // Fall back to Cambo's hosted PNG only if we have no qr string.
    if (qr_string) {
      try { imgBuffer = await generatePlainQR(qr_string); } catch { imgBuffer = null; }
    }
    if (!imgBuffer && imgUrl) {
      try {
        const r = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
        if (r.ok) imgBuffer = Buffer.from(await r.arrayBuffer());
      } catch { /* ignore */ }
    }
    if (!imgBuffer) return { imgBuffer: null, transaction_id: null, error: 'No QR data returned' };
    return { imgBuffer, transaction_id: md5, md5, expires_in: 180, error: null };
  } catch (e) {
    return { imgBuffer: null, transaction_id: null, error: (e as Error).message };
  }
}

export interface KhpayStatus {
  paid: boolean;
  status: string;
  data: Record<string, unknown> | null;
}

export async function checkKhpayStatus(token: string, transaction_id: string, md5?: string | null): Promise<KhpayStatus> {
  try {
    const checkMd5 = md5 || transaction_id;
    const data = await camboRequest(token, { type: 'check_md5', md5: checkMd5 }, { timeoutMs: 15000, retries: 1 });
    const status = String(data?.status ?? '').toLowerCase();
    const paid = status === 'paid' || status === 'success' || status === 'completed';
    return { paid, status: status || 'pending', data };
  } catch (e) {
    console.warn('[Cambo] check error:', (e as Error).message);
    return { paid: false, status: 'error', data: null };
  }
}