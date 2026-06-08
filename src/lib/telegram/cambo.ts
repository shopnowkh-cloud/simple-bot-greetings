import QRCode from 'qrcode';

const CAMBO_BASE = 'https://bakong.cambo-kh.com/api/v1';

async function camboRequest(token: string, params: Record<string, string | number>) {
  const qp = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_token: token });
  try {
    const res = await fetch(`${CAMBO_BASE}/?${qp.toString()}`, { signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { success: false, error: text }; }
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
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
    const res = await camboRequest(token, { type: 'generate_qr', amount });
    if (res.status !== 'success' || !res.data) {
      return { imgBuffer: null, transaction_id: null, error: res.message || res.error || 'API error' };
    }
    const d = res.data;
    const md5: string | null = d.md5 || null;
    const qr_string: string = d.qr || '';
    const imgUrl: string | null = d.Url_qr_code || null;
    let imgBuffer: Buffer | null = null;
    if (imgUrl) {
      try {
        const r = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
        if (r.ok) imgBuffer = Buffer.from(await r.arrayBuffer());
        else throw new Error(`HTTP ${r.status}`);
      } catch {
        if (qr_string) imgBuffer = await generatePlainQR(qr_string);
      }
    } else if (qr_string) {
      imgBuffer = await generatePlainQR(qr_string);
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
    const data = await camboRequest(token, { type: 'check_md5', md5: checkMd5 });
    const status = String(data?.status ?? '').toLowerCase();
    const paid = status === 'paid' || status === 'success' || status === 'completed';
    return { paid, status: status || 'pending', data };
  } catch (e) {
    console.warn('[Cambo] check error:', (e as Error).message);
    return { paid: false, status: 'error', data: null };
  }
}