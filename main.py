import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx
import qrcode
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

# ============= Database =============

_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        db_url = os.environ.get("NEON_DATABASE_URL") or os.environ["DATABASE_URL"]
        _pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5, ssl="require")
    return _pool

async def db_query(text: str, *params) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(text, *params)
        return [dict(r) for r in rows]

async def db_execute(text: str, *params) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.execute(text, *params)

# ============= Telegram API =============

TELEGRAM_API_BASE = "https://api.telegram.org"

def get_bot_token() -> str:
    token = os.environ.get("TELEGRAM_API_KEY")
    if not token:
        raise RuntimeError("TELEGRAM_API_KEY is not configured")
    return token

async def tg_call(method: str, payload: dict) -> Any:
    try:
        token = get_bot_token()
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(
                f"{TELEGRAM_API_BASE}/bot{token}/{method}",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            data = res.json()
            if not res.is_success or not data.get("ok"):
                print(f"[tg] {method} failed [{res.status_code}]: {str(data)[:300]}")
                return None
            return data.get("result")
    except Exception as e:
        print(f"[tg] {method} error: {e}")
        return None

async def send_message(chat_id: int | str, text: str, reply_markup: dict | None = None, extra: dict | None = None) -> dict | None:
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    if extra:
        payload.update(extra)
    return await tg_call("sendMessage", payload)

async def delete_message(chat_id: int | str, message_id: int) -> None:
    await tg_call("deleteMessage", {"chat_id": chat_id, "message_id": message_id})

async def edit_message_text(chat_id: int | str, message_id: int, text: str, reply_markup: dict | None = None) -> dict | None:
    payload: dict = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return await tg_call("editMessageText", payload)

async def answer_callback_query(callback_query_id: str, text: str | None = None, show_alert: bool = False) -> None:
    payload: dict = {"callback_query_id": callback_query_id, "show_alert": show_alert}
    if text:
        payload["text"] = text
    await tg_call("answerCallbackQuery", payload)

async def send_photo(chat_id: int | str, photo: bytes, caption: str | None = None, reply_markup: dict | None = None) -> dict | None:
    try:
        token = get_bot_token()
        async with httpx.AsyncClient(timeout=60) as client:
            data: dict = {"chat_id": str(chat_id), "parse_mode": "HTML"}
            if caption:
                data["caption"] = caption
            if reply_markup:
                data["reply_markup"] = json.dumps(reply_markup)
            res = await client.post(f"{TELEGRAM_API_BASE}/bot{token}/sendPhoto", data=data, files={"photo": ("qr.png", photo, "image/png")})
            resp = res.json()
            if not res.is_success or not resp.get("ok"):
                print(f"[tg] sendPhoto failed: {str(resp)[:300]}")
                return None
            return resp.get("result")
    except Exception as e:
        print(f"[tg] sendPhoto error: {e}")
        return None

async def send_document(chat_id: int | str, buffer: bytes, filename: str, caption: str | None = None) -> dict | None:
    try:
        token = get_bot_token()
        async with httpx.AsyncClient(timeout=60) as client:
            data: dict = {"chat_id": str(chat_id), "parse_mode": "HTML"}
            if caption:
                data["caption"] = caption
            res = await client.post(f"{TELEGRAM_API_BASE}/bot{token}/sendDocument", data=data, files={"document": (filename, buffer, "text/plain")})
            resp = res.json()
            if not res.is_success or not resp.get("ok"):
                print(f"[tg] sendDocument failed: {str(resp)[:300]}")
                return None
            return resp.get("result")
    except Exception as e:
        print(f"[tg] sendDocument error: {e}")
        return None

# ============= Constants =============

BTN_ADD_ACCOUNT       = "➕ បន្ថែម គូប៉ុង"
BTN_DELETE_TYPE       = "🗑 លុបប្រភេទ"
BTN_STOCK             = "📦 ស្តុក គូប៉ុង"
BTN_USERS             = "👥 អ្នកប្រើប្រាស់"
BTN_BUYERS            = "📋 របាយការណ៍ទិញ"
BTN_KHPAY             = "💰 KhPay API"
BTN_CHANNEL           = "📢 Channel ID"
BTN_ADMINS            = "👑 គ្រប់គ្រង Admin"
BTN_MAINTENANCE       = "🛠 Maintenance Mode"
BTN_BROADCAST         = "📢 ផ្សាយព័ត៌មាន"
BTN_BACK_SETTINGS     = "⬅️"
BTN_KHPAY_KEY_EDIT    = "✏️ ប្តូរ KhPay API Key"
BTN_KHPAY_INFO        = "📊 ព័ត៌មាន KhPay"
BTN_CHANNEL_EDIT      = "✏️ ប្តូរ Channel ID"
BTN_CHANNEL_CLEAR     = "🗑 លុប Channel ID"
BTN_ADMIN_ADD         = "➕ បន្ថែម Admin"
BTN_ADMIN_REMOVE      = "➖ ដក Admin"
BTN_MAINT_ON          = "🔴 បិទ Bot"
BTN_MAINT_OFF         = "🟢 បើក Bot"
BTN_CANCEL_INPUT      = "🚫 បោះបង់"
BTN_DELETE_CONFIRM    = "✅ បញ្ជាក់លុប"
BTN_DELETE_CANCEL     = "🚫 បោះបង់ការលុប"
BTN_BROADCAST_CONFIRM = "✅ បញ្ជាក់ផ្សាយ"
BTN_BROADCAST_CANCEL  = "🚫 បោះបង់ការផ្សាយ"

ADMIN_BUTTON_LABELS = {
    BTN_ADD_ACCOUNT, BTN_DELETE_TYPE, BTN_STOCK, BTN_USERS, BTN_BUYERS,
    BTN_KHPAY, BTN_CHANNEL, BTN_ADMINS, BTN_MAINTENANCE, BTN_BROADCAST,
    BTN_BACK_SETTINGS, BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO,
    BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR, BTN_ADMIN_ADD, BTN_ADMIN_REMOVE,
    BTN_MAINT_ON, BTN_MAINT_OFF, BTN_CANCEL_INPUT,
    BTN_DELETE_CONFIRM, BTN_DELETE_CANCEL, BTN_BROADCAST_CONFIRM, BTN_BROADCAST_CANCEL,
}

def kb(rows: list[list[str]]) -> dict:
    return {"keyboard": rows, "resize_keyboard": True, "is_persistent": True}

MAIN_KB            = kb([["💵 ទិញគូប៉ុង"]])
ADMIN_SETTINGS_KB  = kb([[BTN_ADD_ACCOUNT, BTN_DELETE_TYPE], [BTN_STOCK, BTN_BUYERS], [BTN_USERS, BTN_KHPAY], [BTN_CHANNEL, BTN_ADMINS], [BTN_BROADCAST, BTN_MAINTENANCE]])
CANCEL_INPUT_KB    = kb([[BTN_CANCEL_INPUT]])
ADD_ACCOUNT_KB     = kb([[BTN_BACK_SETTINGS]])
BACK_SETTINGS_KB   = kb([[BTN_BACK_SETTINGS]])
KHPAY_SUBMENU_KB   = kb([[BTN_KHPAY_KEY_EDIT, BTN_KHPAY_INFO], [BTN_BACK_SETTINGS]])
CHANNEL_SUBMENU_KB = kb([[BTN_CHANNEL_EDIT, BTN_CHANNEL_CLEAR], [BTN_BACK_SETTINGS]])
ADMINS_SUBMENU_KB  = kb([[BTN_ADMIN_ADD, BTN_ADMIN_REMOVE], [BTN_BACK_SETTINGS]])
MAINTENANCE_SUBMENU_KB = kb([[BTN_MAINT_ON, BTN_MAINT_OFF], [BTN_BACK_SETTINGS]])
BROADCAST_CONFIRM_KB   = kb([[BTN_BROADCAST_CONFIRM], [BTN_BROADCAST_CANCEL]])
REMOVE_KB = {"remove_keyboard": True}

CHECK_PAYMENT_INLINE = {"inline_keyboard": [[{"text": "🚫 បោះបង់", "callback_data": "cancel_purchase"}, {"text": "✅ បានបង់ប្រាក់", "callback_data": "check_payment"}]]}
PAYMENT_TIMEOUT_SEC = 60

def esc(s: Any) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def now_kh() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=7)).strftime("%Y-%m-%d %H:%M:%S") + " +07"

def now_kh_file() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=7)).strftime("%Y%m%d%H%M%S")

def fmt_kh(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        return (datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(hours=7)).strftime("%Y-%m-%d %H:%M:%S") + " +07"
    except Exception:
        return iso

def short_label(t: str, n: int = 36) -> str:
    c = t.strip()
    return c if len(c) <= n else c[:n - 1] + "…"

def type_callback_id(at: str) -> str:
    return hashlib.sha1(at.encode()).hexdigest()[:12]

def format_account(acc: Any) -> str:
    if isinstance(acc, str):
        return acc
    if isinstance(acc, dict):
        if acc.get("email"):   return acc["email"]
        if acc.get("phone"):   return f"{acc['phone']} | {acc.get('password', '')}"
        if acc.get("code"):    return acc["code"]
    return json.dumps(acc)

# ============= Cambo/KhPay =============

CAMBO_BASE = "https://bakong.cambo-kh.com/api/v2"

async def cambo_request(token: str, params: dict, timeout_ms: int = 25000, retries: int = 2) -> dict:
    qp = {**params, "api_token": token}
    url = CAMBO_BASE + "/?" + "&".join(f"{k}={v}" for k, v in qp.items())
    last_err = ""
    for i in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
                res = await client.get(url)
                try:    return res.json()
                except: return {"success": False, "error": res.text}
        except Exception as e:
            last_err = str(e)
            if i < retries:
                await asyncio.sleep(0.4 * (i + 1))
    return {"success": False, "error": last_err or "request failed"}

def generate_plain_qr(qr_string: str) -> bytes:
    img = qrcode.make(qr_string, error_correction=qrcode.constants.ERROR_CORRECT_M)
    img = img.resize((400, 400))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

async def create_khpay_payment(token: str, amount: float) -> dict:
    try:
        res = await cambo_request(token, {"type": "generate_qr", "amount": amount}, timeout_ms=25000, retries=2)
        if res.get("status") != "success" or not res.get("data"):
            return {"img_buffer": None, "transaction_id": None, "md5": None, "error": res.get("message") or res.get("error") or "API error"}
        d = res["data"]
        md5: str | None = d.get("md5")
        qr_string: str = d.get("qr", "")
        img_url: str | None = d.get("Url_qr_code")
        img_buffer: bytes | None = None
        if qr_string:
            try:    img_buffer = generate_plain_qr(qr_string)
            except: img_buffer = None
        if not img_buffer and img_url:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.get(img_url)
                    if r.is_success: img_buffer = r.content
            except: pass
        if not img_buffer:
            return {"img_buffer": None, "transaction_id": None, "md5": None, "error": "No QR data returned"}
        return {"img_buffer": img_buffer, "transaction_id": md5, "md5": md5, "expires_in": 180, "error": None}
    except Exception as e:
        return {"img_buffer": None, "transaction_id": None, "md5": None, "error": str(e)}

async def check_khpay_status(token: str, transaction_id: str, md5: str | None = None) -> dict:
    try:
        data = await cambo_request(token, {"type": "check_md5", "md5": md5 or transaction_id}, timeout_ms=15000, retries=1)
        status = str(data.get("status", "")).lower()
        return {"paid": status in ("paid", "success", "completed"), "status": status or "pending", "data": data}
    except Exception as e:
        print(f"[Cambo] check error: {e}")
        return {"paid": False, "status": "error", "data": None}

# ============= Bot State =============

EMPTY_DB: dict = {"accounts": {"account_types": {}, "prices": {}}, "sessions": {}, "settings": {}, "users": {}, "purchases": []}

async def load_db() -> dict:
    try:
        rows = await db_query("SELECT value FROM bot_state WHERE key = 'db' LIMIT 1")
        if not rows:
            return json.loads(json.dumps(EMPTY_DB))
        v = rows[0]["value"] or {}
        if isinstance(v, str): v = json.loads(v)
        return {
            "accounts": {"account_types": v.get("accounts", {}).get("account_types", {}), "prices": v.get("accounts", {}).get("prices", {})},
            "sessions": v.get("sessions", {}), "settings": v.get("settings", {}),
            "users": v.get("users", {}), "purchases": v.get("purchases", []),
        }
    except Exception as e:
        print(f"[state] load_db error: {e}")
        return json.loads(json.dumps(EMPTY_DB))

async def save_db(db: dict) -> None:
    try:
        await db_execute(
            "INSERT INTO bot_state (key, value, updated_at) VALUES ('db', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
            json.dumps(db),
        )
    except Exception as e:
        print(f"[state] save_db error: {e}")

async def mark_update_processed(update_id: int) -> bool:
    try:
        await db_execute("INSERT INTO telegram_updates (update_id) VALUES ($1)", update_id)
        return True
    except Exception:
        return False

# ============= Bot Context =============

def load_ctx(db: dict) -> dict:
    admin_id = int(os.environ.get("ADMIN_ID", "0"))
    extra_admins: set[int] = set()
    ea = db["settings"].get("EXTRA_ADMIN_IDS", "")
    if ea:
        try: extra_admins = set(map(int, json.loads(ea)))
        except: pass
    return {
        "db": db, "ADMIN_ID": admin_id, "EXTRA_ADMIN_IDS": extra_admins,
        "CHANNEL_ID": db["settings"].get("TELEGRAM_CHANNEL_ID", ""),
        "CAMBO_API_TOKEN": db["settings"].get("CAMBO_API_TOKEN") or os.environ.get("CAMBO_API_TOKEN", ""),
        "MAINTENANCE_MODE": db["settings"].get("MAINTENANCE_MODE") == "true",
    }

def is_admin(ctx: dict, uid: int) -> bool:
    return uid == ctx["ADMIN_ID"] or uid in ctx["EXTRA_ADMIN_IDS"]

async def main_kb(ctx: dict, uid: int) -> dict:
    return ADMIN_SETTINGS_KB if is_admin(ctx, uid) else REMOVE_KB

def type_from_cb_id(ctx: dict, cid: str) -> str | None:
    return next((t for t in ctx["db"]["accounts"]["account_types"] if type_callback_id(t) == cid), None)

# ============= Common UI =============

async def notify_admin_new_user(ctx: dict, user: dict) -> None:
    uid = user["id"]
    if uid == ctx["ADMIN_ID"] or str(uid) in ctx["db"]["users"]:
        return
    ctx["db"]["users"][str(uid)] = {
        "first_name": user.get("first_name", ""), "last_name": user.get("last_name", ""),
        "username": user.get("username", ""), "first_seen": datetime.now(timezone.utc).isoformat(),
    }
    full  = " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or "N/A"
    uname = f"@{user['username']}" if user.get("username") else "—"
    asyncio.create_task(send_message(ctx["ADMIN_ID"], f"🆕 <b>អ្នកប្រើប្រាស់ថ្មី!</b>\n\n👤 ឈ្មោះ: {esc(full)}\n🔖 Username: {esc(uname)}\n🪪 ID: <code>{uid}</code>"))

async def show_account_selection(ctx: dict, chat_id: int) -> None:
    available = [{"at": at, "count": len(v)} for at, v in ctx["db"]["accounts"]["account_types"].items() if len(v) > 0]
    if not available:
        await send_message(chat_id, "<i>សូមអភ័យទោស អស់ពីស្តុក 🪤</i>")
        return
    rows = [[{"text": f"{a['at']} – មានក្នុងស្តុក {a['count']}", "callback_data": f"buy:{type_callback_id(a['at'])}"}] for a in available]
    await send_message(chat_id, "<b>សូមជ្រើសរើសគូប៉ុងដើម្បីទិញ៖</b>", {"inline_keyboard": rows})

async def send_admin_settings_menu(ctx: dict, chat_id: int) -> None:
    await send_message(chat_id, "<b>⚙️ ការកំណត់ Admin</b>\n\nសូមជ្រើសរើសប្រតិបត្តិការខាងក្រោម៖", ADMIN_SETTINGS_KB)

# ============= Payment =============

async def start_payment_for_session(ctx: dict, chat_id: int, user_id: int, session: dict, cb_id: str | None = None) -> bool:
    at = session["account_type"]
    qty = session["quantity"]
    pool = ctx["db"]["accounts"]["account_types"].get(at, [])
    if len(pool) < qty:
        if cb_id: await answer_callback_query(cb_id, f"សូមអភ័យទោស! មានត្រឹមតែ {len(pool)} គូប៉ុង នៅក្នុងស្តុក", True)
        ctx["db"]["sessions"].pop(str(user_id), None)
        return False
    session["reserved_accounts"] = pool[:qty]
    ctx["db"]["accounts"]["account_types"][at] = pool[qty:]
    session["available_count"] = len(ctx["db"]["accounts"]["account_types"][at])
    if cb_id: await answer_callback_query(cb_id, "កំពុងបង្កើត QR...")
    session["state"] = "payment_pending"
    result = await create_khpay_payment(ctx["CAMBO_API_TOKEN"], session["total_price"])
    img_buffer, transaction_id, md5, error = result.get("img_buffer"), result.get("transaction_id"), result.get("md5"), result.get("error")
    if not img_buffer or not transaction_id:
        if is_admin(ctx, user_id):
            await send_message(chat_id, f"❌ <b>QR បរាជ័យ (Admin Debug):</b>\n<code>{esc(str(error))}</code>")
        else:
            await send_message(chat_id, "❌ <b>មានបញ្ហាក្នុងការបង្កើត QR Code</b>\n\nសូមព្យាយាមម្ដងទៀត។")
            asyncio.create_task(send_message(ctx["ADMIN_ID"], f"⚠️ QR Error (user {user_id}): <code>{esc(str(error))}</code>"))
        ctx["db"]["sessions"].pop(str(user_id), None)
        return False
    session["transaction_id"] = transaction_id
    session["md5"] = md5
    session["qr_sent_at"] = int(time.time() * 1000)
    photo = await send_photo(chat_id, img_buffer, reply_markup=CHECK_PAYMENT_INLINE)
    if photo:
        session["photo_message_id"] = photo["message_id"]
        session["qr_message_id"]    = photo["message_id"]
    ctx["db"]["sessions"][str(user_id)] = session
    print(f"[INFO] KhPay QR sent to user {user_id}: ${session['total_price']}, TxnID: {transaction_id}")
    return True

async def deliver_accounts(ctx: dict, chat_id: int, user_id: int, session: dict, payment_data: dict | None = None) -> None:
    at  = session["account_type"]
    qty = session["quantity"]
    for key in ["photo_message_id", "qr_message_id"]:
        if mid := session.get(key): asyncio.create_task(delete_message(chat_id, mid))
    reserved  = session.get("reserved_accounts", [])
    delivered = reserved[:qty] if len(reserved) >= qty else None
    if delivered is None and len(ctx["db"]["accounts"]["account_types"].get(at, [])) >= qty:
        pool = ctx["db"]["accounts"]["account_types"][at]
        delivered = pool[:qty]
        ctx["db"]["accounts"]["account_types"][at] = pool[qty:]
    session["reserved_accounts"] = []
    ctx["db"]["sessions"].pop(str(user_id), None)
    if not delivered:
        await send_message(chat_id, f"❌ <b>មានបញ្ហា!</b>\n\nគ្មាន គូប៉ុង ប្រភេទ {esc(at)} ក្នុងស្តុក។")
        return
    ctx["db"]["purchases"].append({"user_id": user_id, "account_type": at, "quantity": qty, "total_price": session["total_price"], "accounts": delivered, "purchased_at": datetime.now(timezone.utc).isoformat()})
    for i, acc in enumerate(delivered):
        msg = f"🎉 <b>ការទិញបានបញ្ជាក់ដោយជោគជ័យ</b>\n\nគូប៉ុងរបស់អ្នក៖ 👇\n\n<code>{esc(format_account(acc))}</code>\n\n<i>សូមអរគុណសម្រាប់ការទិញ 🙏</i>"
        await send_message(chat_id, msg, await main_kb(ctx, user_id) if i == len(delivered) - 1 else None)
    try:
        pd       = payment_data or {}
        from_acc = pd.get("fromAccountId") or pd.get("hash") or "N/A"
        memo     = pd.get("memo") or "គ្មាន"
        ref      = pd.get("externalRef") or pd.get("transactionId") or pd.get("md5") or "N/A"
        admin_msg = (
            "🎉 <b>ទទួលបានការបង់ប្រាក់ជោគជ័យ</b>\n━━━━━━━━━━━━━━━━━━━\n"
            f"🆔 <b>អ្នកទិញ(ID):</b> {user_id}\n📦 <b>ប្រភេទ:</b> {esc(at)} × {qty}\n"
            f"💵 <b>ទឹកប្រាក់:</b> ${session['total_price']}\n👤 <b>ពីធនាគារ:</b> <code>{esc(from_acc)}</code>\n"
            f"📝 <b>ចំណាំ:</b> {esc(memo)}\n🧾 <b>លេខយោង:</b> <code>{esc(ref)}</code>\n⏰ <b>ម៉ោង:</b> {now_kh()}"
        )
        asyncio.create_task(send_message(ctx["ADMIN_ID"], admin_msg))
        if ctx["CHANNEL_ID"] and str(ctx["CHANNEL_ID"]) != str(ctx["ADMIN_ID"]):
            asyncio.create_task(send_message(ctx["CHANNEL_ID"], admin_msg))
    except Exception as e:
        print(f"[WARN] admin payment notify: {e}")
    print(f"[INFO] Delivered {qty}× {at} to user {user_id}")

async def run_watchdog(pre_ctx: dict | None = None) -> None:
    ctx = pre_ctx if pre_ctx else load_ctx(await load_db())
    db  = ctx["db"]
    pending = [(uid, s) for uid, s in db["sessions"].items() if s.get("state") == "payment_pending"]
    if not pending: return
    dirty = False
    for uid_str, sess in pending:
        user_id = int(uid_str)
        elapsed = int(time.time() * 1000) - (sess.get("qr_sent_at") or 0)
        if elapsed >= PAYMENT_TIMEOUT_SEC * 1000:
            at = sess.get("account_type")
            reserved = sess.get("reserved_accounts", [])
            if reserved and at: db["accounts"]["account_types"][at] = reserved + db["accounts"]["account_types"].get(at, [])
            db["sessions"].pop(uid_str, None)
            dirty = True
            if sess.get("photo_message_id"): asyncio.create_task(delete_message(user_id, sess["photo_message_id"]))
            asyncio.create_task(send_message(user_id, "⌛ <b>QR Code បានផុតកំណត់</b>\n\nសូមបង្កើតការទិញម្ដងទៀត។"))
            asyncio.create_task(show_account_selection(ctx, user_id))
            continue
        if not sess.get("transaction_id"): continue
        try:
            result = await check_khpay_status(ctx["CAMBO_API_TOKEN"], sess["transaction_id"], sess.get("md5"))
            if not result["paid"]: continue
            cur = db["sessions"].get(uid_str)
            if not cur or cur.get("transaction_id") != sess.get("transaction_id") or cur.get("state") != "payment_pending": continue
            cur["state"] = "delivering"
            dirty = True
            await deliver_accounts(ctx, user_id, user_id, cur, result.get("data"))
        except Exception as e:
            print(f"[Watchdog] check error {sess.get('transaction_id')}: {e}")
    if dirty or pending: await save_db(db)

# ============= Admin export helpers =============

async def export_stock(ctx: dict, chat_id: int) -> None:
    types  = ctx["db"]["accounts"]["account_types"]
    prices = ctx["db"]["accounts"]["prices"]
    names  = sorted(types.keys())
    if not names:
        await send_message(chat_id, "📦 មិនមានប្រភេទ គូប៉ុង ឡើយទេ។", ADMIN_SETTINGS_KB)
        return
    total = sum(len(types.get(t, [])) for t in names)
    W = 60
    lines = ["=" * W, "  ស្តុក គូប៉ុង / COUPON STOCK".ljust(W), f"  {now_kh()}".ljust(W), f"  ប្រភេទ: {len(names)}  |  សរុប: {total} គូប៉ុង".ljust(W), "=" * W, ""]
    for t in names:
        pool = types.get(t, [])
        lines += [f"[ {t} ]  💰 ${prices.get(t, 0)}  📦 {len(pool)} គូប៉ុង", "─" * W]
        lines += [f"  {i+1}. {format_account(a)}" for i, a in enumerate(pool)] if pool else ["  (គ្មានក្នុងស្តុក)"]
        lines.append("")
    lines.append("=" * W)
    await send_document(chat_id, "\n".join(lines).encode("utf-8"), f"stock_{now_kh_file()}.txt", f"📦 <b>ស្តុក គូប៉ុង</b> — {len(names)} ប្រភេទ, {total} នៅសល់")
    await send_admin_settings_menu(ctx, chat_id)

async def export_buyers(ctx: dict, chat_id: int) -> None:
    if not ctx["db"]["purchases"]:
        await send_message(chat_id, "មិនមានទិន្នន័យ​ទិញ​នៅឡើយ​ទេ។", ADMIN_SETTINGS_KB)
        return
    grouped: dict = {}
    for p in ctx["db"]["purchases"]:
        uid = str(p["user_id"])
        if uid not in grouped:
            u = ctx["db"]["users"].get(uid, {})
            grouped[uid] = {"first_name": u.get("first_name", ""), "last_name": u.get("last_name", ""), "username": u.get("username", ""), "purchases": []}
        grouped[uid]["purchases"].append(p)
    W = 60
    lines = ["=" * W, "  BUYERS REPORT".ljust(W), f"  {now_kh()}".ljust(W), "=" * W, f"  Total buyers : {len(grouped)}"]
    for uid, info in grouped.items():
        fn = " ".join(filter(None, [info["first_name"], info["last_name"]])) or "(no name)"
        un = f"@{info['username']}" if info["username"] else "—"
        lines += ["", "─" * W, f"  ID       : {uid}", f"  Name     : {fn}", f"  Username : {un}", f"  Purchases: {len(info['purchases'])}", "─" * W]
        for i, p in enumerate(info["purchases"]):
            lines += [f"  [{i+1}] {p['account_type']}", f"      Qty   : {p['quantity']}", f"      Price : ${p['total_price']}", f"      Date  : {fmt_kh(p.get('purchased_at'))}", "      Accounts:"]
            lines += [f"        • {format_account(a)}" for a in (p.get("accounts") or [])] or ["        (none)"]
    lines += ["", "=" * W, "=" * W]
    await send_document(chat_id, "\n".join(lines).encode("utf-8"), f"buyers_{now_kh_file()}.txt", f"📋 របាយការណ៍ទិញ — {len(grouped)} អ្នក​ទិញ")
    await send_admin_settings_menu(ctx, chat_id)

async def show_users_list(ctx: dict, chat_id: int) -> None:
    rows = list(ctx["db"]["users"].items())
    if not rows:
        await send_message(chat_id, "📭 <b>មិនទាន់មានអ្នកប្រើប្រាស់ទេ។</b>", BACK_SETTINGS_KB)
        return
    lines = [f"👥 អ្នកប្រើប្រាស់សរុប: {len(rows)}", ""]
    for uid, info in rows:
        full  = " ".join(filter(None, [info.get("first_name"), info.get("last_name")])) or "N/A"
        uname = f"@{info['username']}" if info.get("username") else "—"
        lines += [full, f"   🔖 {uname}", f"   🪪 {uid}", ""]
    await send_document(chat_id, "\n".join(lines).encode("utf-8"), f"users_{now_kh_file()}.txt", f"👥 បញ្ជីអ្នកប្រើប្រាស់ — {len(rows)} នាក់")
    await send_admin_settings_menu(ctx, chat_id)

async def send_khpay_info(ctx: dict, chat_id: int) -> None:
    token = ctx["CAMBO_API_TOKEN"]
    short = f"<code>{esc(token[:16])}…{esc(token[-4:])}</code>" if token else "❌ មិនទាន់កំណត់"
    await send_message(chat_id, f"💰 <b>Cambo Payment Info</b>\n━━━━━━━━━━━━━━━━━━━\n🌐 <b>API:</b> <code>bakong.cambo-kh.com/api/v2</code>\n🔑 <b>Token:</b> {short}\n━━━━━━━━━━━━━━━━━━━\n✅ <b>Generate QR:</b> type=generate_qr\n✅ <b>Check MD5:</b> type=check_md5", KHPAY_SUBMENU_KB)

async def run_broadcast(ctx: dict, admin_chat_id: int, bcast_text: str) -> None:
    uids = list(ctx["db"]["users"].keys())
    sent = blocked = 0
    for uid_str in uids:
        r = await send_message(int(uid_str), bcast_text)
        if r: sent += 1
        else: blocked += 1
        await asyncio.sleep(0.05)
    await send_message(admin_chat_id, f"📢 <b>ផ្សាយ​សារ​បាន​ចប់</b>\n━━━━━━━━━━━━━━━━━━━\n👥 សរុប:         {len(uids)}\n✅ ផ្ញើ​ជោគជ័យ:   {sent}\n⛔ បាន​ប្លុក/លុប:  {blocked}\n❌ បរាជ័យ:        0", ADMIN_SETTINGS_KB)

# ============= Admin dispatch =============

async def dispatch_admin_button(ctx: dict, chat_id: int, uid: int, btn: str) -> None:
    db = ctx["db"]
    if btn == BTN_ADD_ACCOUNT:
        db["sessions"][str(uid)] = {"state": "waiting_for_accounts"}
        await send_message(chat_id, "<b>បញ្ចូលគូប៉ុងសម្រាប់លក់</b>", ADD_ACCOUNT_KB)
    elif btn == BTN_DELETE_TYPE:
        types = list(db["accounts"]["account_types"].keys())
        if not types: await send_message(chat_id, "⚠️ <b>មិនមានប្រភេទ គូប៉ុង ណាមួយទេ!</b>"); return
        labels_map: dict = {}
        rows = []
        for t in types:
            label = f"{short_label(t)} – មានក្នុងស្តុក {len(db['accounts']['account_types'][t])}"
            labels_map[label] = t
            rows.append([label])
        rows.append([BTN_BACK_SETTINGS])
        db["sessions"][str(uid)] = {"state": "delete_type_select", "labels": labels_map}
        await send_message(chat_id, "🗑 <b>ជ្រើសរើសប្រភេទ គូប៉ុង ដែលចង់លុប៖</b>", {"keyboard": rows, "resize_keyboard": True, "is_persistent": True})
    elif btn == BTN_STOCK:    await export_stock(ctx, chat_id)
    elif btn == BTN_BUYERS:   await export_buyers(ctx, chat_id)
    elif btn == BTN_USERS:    await show_users_list(ctx, chat_id)
    elif btn == BTN_KHPAY:    await send_message(chat_id, f"💰 <b>Cambo API Token បច្ចុប្បន្ន៖</b>\n\n<code>{esc(ctx['CAMBO_API_TOKEN'])}</code>", KHPAY_SUBMENU_KB)
    elif btn == BTN_KHPAY_KEY_EDIT:
        db["sessions"][str(uid)] = {"state": "admin_input:khpay_key"}
        await send_message(chat_id, "💰 សូមផ្ញើ <b>Cambo API Token</b> ថ្មី:\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>", CANCEL_INPUT_KB)
    elif btn == BTN_KHPAY_INFO: await send_khpay_info(ctx, chat_id)
    elif btn == BTN_CHANNEL:
        cur = ctx["CHANNEL_ID"] or "(មិនទាន់កំណត់)"
        await send_message(chat_id, f"📢 <b>Channel ID បច្ចុប្បន្ន៖</b>\n<code>{esc(str(cur))}</code>", CHANNEL_SUBMENU_KB)
    elif btn == BTN_CHANNEL_EDIT:
        db["sessions"][str(uid)] = {"state": "admin_input:channel"}
        await send_message(chat_id, "📢 សូមផ្ញើ <b>Channel ID</b> ថ្មី (ឧ. <code>-1001234567890</code>):\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>", CANCEL_INPUT_KB)
    elif btn == BTN_CHANNEL_CLEAR:
        db["settings"]["TELEGRAM_CHANNEL_ID"] = ""; ctx["CHANNEL_ID"] = ""
        await send_message(chat_id, "✅ បានលុប Channel ID", ADMIN_SETTINGS_KB)
    elif btn == BTN_ADMINS:
        extras_str = "\n".join(f"• <code>{x}</code>" for x in sorted(ctx["EXTRA_ADMIN_IDS"])) or "(គ្មាន)"
        await send_message(chat_id, f"👑 <b>Admin បឋម៖</b> <code>{ctx['ADMIN_ID']}</code>\n\n➕ <b>Admin បន្ថែម៖</b>\n{extras_str}", ADMINS_SUBMENU_KB)
    elif btn == BTN_ADMIN_ADD:
        db["sessions"][str(uid)] = {"state": "admin_input:admin_add"}
        await send_message(chat_id, "➕ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់បន្ថែម:", CANCEL_INPUT_KB)
    elif btn == BTN_ADMIN_REMOVE:
        db["sessions"][str(uid)] = {"state": "admin_input:admin_remove"}
        await send_message(chat_id, "➖ សូមផ្ញើ <b>Telegram User ID</b> ដែលចង់ដក:", CANCEL_INPUT_KB)
    elif btn == BTN_MAINTENANCE:
        status = "🔴 បិទ" if ctx["MAINTENANCE_MODE"] else "🟢 បើក"
        await send_message(chat_id, f"🛠 <b>ស្ថានភាព Bot បច្ចុប្បន្ន៖</b> {status}", MAINTENANCE_SUBMENU_KB)
    elif btn == BTN_MAINT_ON:
        db["settings"]["MAINTENANCE_MODE"] = "true"; ctx["MAINTENANCE_MODE"] = True
        await send_message(chat_id, "🔴 បានបិទ Bot", ADMIN_SETTINGS_KB)
    elif btn == BTN_MAINT_OFF:
        db["settings"]["MAINTENANCE_MODE"] = "false"; ctx["MAINTENANCE_MODE"] = False
        await send_message(chat_id, "🟢 បានបើក Bot", ADMIN_SETTINGS_KB)
    elif btn == BTN_BROADCAST:
        db["sessions"][str(uid)] = {"state": "admin_input:broadcast"}
        await send_message(chat_id, "📢 សូមផ្ញើ​សារ​ដែល​ចង់​ផ្សាយ​ទៅ​អ្នក​ប្រើ​ប្រាស់​ទាំង​អស់៖\n\n<i>ចុច 🚫 បោះបង់ ដើម្បីបោះបង់</i>", CANCEL_INPUT_KB)
    else:
        await send_admin_settings_menu(ctx, chat_id)

async def handle_admin_input(ctx: dict, chat_id: int, uid: int, msg_id: int, key: str, text: str) -> None:
    db = ctx["db"]
    if text in {"បោះបង់", "🚫 បោះបង់", BTN_CANCEL_INPUT, BTN_BACK_SETTINGS}:
        db["sessions"].pop(str(uid), None); await send_admin_settings_menu(ctx, chat_id); return
    if key == "khpay_key":
        if not text: await send_message(chat_id, "❌ Token មិនត្រឹមត្រូវ\n\nសូមផ្ញើ Token ត្រឹមត្រូវ (ឬចុច 🚫 បោះបង់)"); return
        db["settings"]["CAMBO_API_TOKEN"] = text; ctx["CAMBO_API_TOKEN"] = text
        db["sessions"].pop(str(uid), None); asyncio.create_task(delete_message(chat_id, msg_id))
        await send_message(chat_id, f"✅ បានប្តូរ <b>Cambo API Token</b>\n<code>{esc(text[:12])}…{esc(text[-4:])}</code>", await main_kb(ctx, uid))
    elif key == "channel":
        if not text: await send_message(chat_id, "សូមផ្ញើ Channel ID ថ្មី ឬ <code>off</code> ដើម្បីបិទ"); return
        val = "" if text.lower() in ("off", "none", "clear", "delete", "remove") else text
        db["settings"]["TELEGRAM_CHANNEL_ID"] = val; ctx["CHANNEL_ID"] = val
        db["sessions"].pop(str(uid), None)
        await send_message(chat_id, f"✅ បានកំណត់ Channel ID ទៅជា <code>{esc(val or '(ទទេ)')}</code>", await main_kb(ctx, uid))
    elif key == "admin_add":
        try: target = int(text)
        except ValueError: await send_message(chat_id, "❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)"); return
        if target == ctx["ADMIN_ID"]:
            db["sessions"].pop(str(uid), None); await send_message(chat_id, "ℹ️ Admin បឋមមិនអាចលុប/បន្ថែមបានទេ។", await main_kb(ctx, uid)); return
        ctx["EXTRA_ADMIN_IDS"].add(target); db["settings"]["EXTRA_ADMIN_IDS"] = json.dumps(list(ctx["EXTRA_ADMIN_IDS"]))
        db["sessions"].pop(str(uid), None); await send_message(chat_id, f"✅ បានបន្ថែម <code>{target}</code> ជា admin")
    elif key == "admin_remove":
        try: target = int(text)
        except ValueError: await send_message(chat_id, "❌ user_id ត្រូវតែជាលេខ (ឬចុច 🚫 បោះបង់)"); return
        ctx["EXTRA_ADMIN_IDS"].discard(target); db["settings"]["EXTRA_ADMIN_IDS"] = json.dumps(list(ctx["EXTRA_ADMIN_IDS"]))
        db["sessions"].pop(str(uid), None); await send_message(chat_id, f"✅ បានដក <code>{target}</code> ចាក admin")
    elif key == "broadcast":
        db["sessions"][str(uid)] = {"state": "broadcast_confirm", "broadcast_message_id": msg_id, "broadcast_chat_id": chat_id, "broadcast_text": text}
        await send_message(chat_id, f"📢 <b>ព្រមព្រៀងផ្សាយ:</b>\n\n{esc(text)}\n\n<i>ផ្សាយទៅអ្នកប្រើ {len(db['users'])} នាក់</i>", BROADCAST_CONFIRM_KB)

# ============= Update dispatcher =============

async def handle_channel_post(ctx: dict, post: dict) -> None:
    try:
        text = post.get("text") or post.get("caption") or ""
        if not text or ("noreply@e-gets.com" not in text and "e-gets.com" not in text): return
        email_match = re.search(r"📧[^\n:]*:\s*([^\s\n]+)", text)
        if not email_match: return
        email = email_match.group(1).strip()
        code_match = re.search(r"^\s*(\d{4,8})\s*$", text, re.MULTILINE)
        if not code_match: return
        code = code_match.group(1).strip()
        sent_ids: set[int] = set()
        for p in ctx["db"]["purchases"]:
            if any((a.get("email") or a.get("code") or "").strip().lower() == email.lower() for a in (p.get("accounts") or [])):
                uid = p["user_id"]
                if uid not in sent_ids:
                    sent_ids.add(uid)
                    asyncio.create_task(send_message(uid, f"📩 <b>លេខកូដផ្ទៀងផ្ទាត់ E-GetS</b>\n\n<code>{esc(email)}</code>\n\n<code>{code}</code>"))
    except Exception as e:
        print(f"[EGets] channel_post error: {e}")

async def handle_message(ctx: dict, msg: dict) -> None:
    if not msg.get("from"): return
    user = msg["from"]; uid = user["id"]; chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    db   = ctx["db"]
    await notify_admin_new_user(ctx, user)

    if text == "/start" or text.startswith("/start "):
        if ctx["MAINTENANCE_MODE"] and not is_admin(ctx, uid):
            await send_message(chat_id, "🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>"); return
        if (db["sessions"].get(str(uid)) or {}).get("state") == "payment_pending":
            await send_message(chat_id, "⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្តើមការទិញថ្មី។"); return
        db["sessions"].pop(str(uid), None)
        if is_admin(ctx, uid): await send_message(chat_id, "👋 <b>សួស្ដី Admin</b>", await main_kb(ctx, uid))
        await show_account_selection(ctx, chat_id); return

    if ctx["MAINTENANCE_MODE"] and not is_admin(ctx, uid):
        await send_message(chat_id, "🔧 <b>Bot កំពុង Update សូមរង់ចាំមួយភ្លែត...</b>"); return

    if is_admin(ctx, uid):
        sess  = db["sessions"].get(str(uid), {})
        state = sess.get("state", "")
        if text == BTN_BACK_SETTINGS:
            db["sessions"].pop(str(uid), None); await send_admin_settings_menu(ctx, chat_id); return
        if state.startswith("admin_input:"):
            await handle_admin_input(ctx, chat_id, uid, msg["message_id"], state[len("admin_input:"):], text); return
        if state == "delete_type_select":
            type_name = (sess.get("labels") or {}).get(text)
            if type_name and type_name in db["accounts"]["account_types"]:
                count = len(db["accounts"]["account_types"][type_name])
                price = db["accounts"]["prices"].get(type_name, 0)
                db["sessions"][str(uid)] = {"state": "delete_type_confirm", "type_name": type_name}
                await send_message(chat_id, f"⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: {esc(type_name)}\n🔹 ចំនួន: {count}\n🔹 តម្លៃ: ${price}</blockquote>",
                    {"keyboard": [[BTN_DELETE_CONFIRM], [BTN_DELETE_CANCEL]], "resize_keyboard": True, "is_persistent": True})
            return
        if state == "delete_type_confirm":
            type_name = sess.get("type_name"); db["sessions"].pop(str(uid), None)
            if text == BTN_DELETE_CONFIRM and type_name:
                count = len(db["accounts"]["account_types"].get(type_name, []))
                db["accounts"]["account_types"].pop(type_name, None); db["accounts"]["prices"].pop(type_name, None)
                await send_message(chat_id, f"✅ <b>បានលុបប្រភេទ <code>{esc(type_name)}</code> ចំនួន {count} records!</b>", ADMIN_SETTINGS_KB)
            else: await send_message(chat_id, "🚫 <b>បានបោះបង់ការលុប</b>", ADMIN_SETTINGS_KB)
            return
        if state == "broadcast_confirm":
            bcast_text = sess.get("broadcast_text", ""); db["sessions"].pop(str(uid), None)
            if text == BTN_BROADCAST_CONFIRM and bcast_text:
                await send_message(chat_id, "📢 កំពុង​ផ្សាយ​សារ ... សូមរង់ចាំ", ADMIN_SETTINGS_KB)
                await save_db(db); await run_broadcast(ctx, chat_id, bcast_text); return
            await send_message(chat_id, "🚫 <b>បាន​បោះបង់​ការ​ផ្សាយ</b>", ADMIN_SETTINGS_KB); return
        if state == "waiting_for_accounts":
            if text in (BTN_BACK_SETTINGS, BTN_CANCEL_INPUT):
                db["sessions"].pop(str(uid), None); await send_admin_settings_menu(ctx, chat_id); return
            lines_raw = [l.strip() for l in text.split("\n") if l.strip()]
            if not lines_raw: await send_message(chat_id, "<b>អ៊ីមែលមិនត្រឹមត្រូវតាមទម្រង់</b>", ADD_ACCOUNT_KB); return
            new_accounts = [{"phone": p[0].strip(), "password": p[1].strip()} if "|" in l and (p := l.split("|", 1)) else {"code": l} for l in lines_raw]
            existing_types = list(db["accounts"]["account_types"].keys())
            db["sessions"][str(uid)] = {"state": "waiting_for_account_type", "accounts": new_accounts}
            await send_message(chat_id, f"<b>បានបញ្ចូល គូប៉ុង ចំនួន {len(new_accounts)}\n\nសូមជ្រើសរើស ឬបញ្ចូលប្រភេទ គូប៉ុង៖</b>",
                {"keyboard": [[t] for t in existing_types] + [[BTN_BACK_SETTINGS]], "resize_keyboard": True, "is_persistent": True}); return
        if state == "waiting_for_account_type":
            if text in (BTN_BACK_SETTINGS, BTN_CANCEL_INPUT):
                db["sessions"].pop(str(uid), None); await send_admin_settings_menu(ctx, chat_id); return
            existing_price = db["accounts"]["prices"].get(text)
            db["sessions"][str(uid)] = {**sess, "state": "waiting_for_price", "account_type": text}
            if existing_price is not None:
                await send_message(chat_id, f"<b>ប្រភេទ <code>{esc(text)}</code> មានស្រាប់ ដែលមានតម្លៃ {existing_price}$\n\nតម្លៃត្រូវតែដូចគ្នា ({existing_price}$) ដើម្បីបន្ថែម គូប៉ុង</b>", ADD_ACCOUNT_KB)
            else: await send_message(chat_id, f"<b>សូមដាក់តម្លៃក្នុងប្រភេទ គូប៉ុង {esc(text)}</b>", ADD_ACCOUNT_KB)
            return
        if state == "waiting_for_price":
            if text in (BTN_BACK_SETTINGS, BTN_CANCEL_INPUT):
                db["sessions"].pop(str(uid), None); await send_admin_settings_menu(ctx, chat_id); return
            try: price = float(text.replace("$", "").strip())
            except ValueError: await send_message(chat_id, "តម្លៃមិនត្រឹមត្រូវ។ សូមបញ្ចូលតម្លៃជាលេខ (ឧ: 5.99)"); return
            if price < 0: await send_message(chat_id, "តម្លៃមិនត្រឹមត្រូវ។ សូមបញ្ចូលតម្លៃជាលេខ (ឧ: 5.99)"); return
            account_type = sess["account_type"]; accs_to_add = sess.get("accounts", [])
            existing_price = db["accounts"]["prices"].get(account_type)
            if existing_price is not None and round(existing_price * 10000) != round(price * 10000):
                await send_message(chat_id, f"❌ <b>មិនអាចបញ្ចូលបាន!</b>\n\nប្រភេទ <code>{esc(account_type)}</code> មានតម្លៃ <b>{existing_price}$</b> ស្រាប់។\nតម្លៃ <b>{price}$</b> មិនដូចគ្នា។ សូមប្រើ <b>{existing_price}$</b>", ADD_ACCOUNT_KB); return
            all_existing = {(a.get("code") or a.get("email") or a.get("phone") or "").lower() for accs in db["accounts"]["account_types"].values() for a in accs if (a.get("code") or a.get("email") or a.get("phone") or "")}
            to_add = [a for a in accs_to_add if (a.get("code") or a.get("email") or a.get("phone") or "").lower() not in all_existing]
            dupes  = len(accs_to_add) - len(to_add)
            if account_type not in db["accounts"]["account_types"]: db["accounts"]["account_types"][account_type] = []
            db["accounts"]["account_types"][account_type].extend(to_add)
            db["accounts"]["prices"][account_type] = round(price * 10000) / 10000
            db["sessions"].pop(str(uid), None)
            await send_message(chat_id, f"✅ <b>បានបញ្ចូល គូប៉ុង ដោយជោគជ័យ</b>\n\n<blockquote>🔹 ចំនួន: {len(to_add)}\n🔹 ប្រភេទ: {esc(account_type)}\n🔹 តម្លៃ: {price}$</blockquote>" + (f"\n\n⚠️ ដដែល (រំលង): {dupes}" if dupes else ""))
            await send_admin_settings_menu(ctx, chat_id); return
        if text in ADMIN_BUTTON_LABELS: await dispatch_admin_button(ctx, chat_id, uid, text); return

    if text == "💵 ទិញគូប៉ុង":
        if (db["sessions"].get(str(uid)) or {}).get("state") == "payment_pending":
            await send_message(chat_id, "⏳ <b>សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន</b>\n\nអ្នកមានការបញ្ជាទិញមួយកំពុងដំណើរការ។ សូមបញ្ចប់ការទូទាត់ ឬចុច <b>🚫 បោះបង់</b> មុននឹងចាប់ផ្ដើមការទិញថ្មី។"); return
        db["sessions"].pop(str(uid), None); await show_account_selection(ctx, chat_id); return
    if (db["sessions"].get(str(uid)) or {}).get("state") == "payment_pending":
        await send_message(chat_id, "⏳ <b>សូមបញ្ចប់ការទូទាត់ QR ជាមុនសិន</b>\nឬចុច <b>🚫 បោះបង់</b> ដើម្បីបោះបង់", CHECK_PAYMENT_INLINE); return
    await send_message(chat_id, "⚙️" if is_admin(ctx, uid) else "💵", await main_kb(ctx, uid) if is_admin(ctx, uid) else MAIN_KB)
    await show_account_selection(ctx, chat_id)

async def handle_callback(ctx: dict, cb: dict) -> None:
    data    = cb.get("data", "")
    uid     = cb["from"]["id"]
    chat_id = cb.get("message", {}).get("chat", {}).get("id") or uid
    msg_id  = cb.get("message", {}).get("message_id")
    db      = ctx["db"]
    await notify_admin_new_user(ctx, cb["from"])

    if data.startswith("buy:"):
        at = type_from_cb_id(ctx, data[4:])
        if not at: await answer_callback_query(cb["id"], "ប្រភេទនេះមិនមានទៀតហើយ។", True); return
        if (db["sessions"].get(str(uid)) or {}).get("state") == "payment_pending":
            await answer_callback_query(cb["id"], "សូមបញ្ចប់ការទិញបច្ចុប្បន្នជាមុនសិន", True); return
        await answer_callback_query(cb["id"])
        pool  = db["accounts"]["account_types"].get(at, [])
        price = db["accounts"]["prices"].get(at, 0)
        if not pool: await send_message(chat_id, f"<i>សូមអភ័យទោស គូប៉ុង {esc(at)} អស់ពីស្តុក 🪤</i>"); return
        old = db["sessions"].get(str(uid))
        if old and old.get("reserved_accounts") and old.get("account_type"):
            old_at = old["account_type"]
            db["accounts"]["account_types"][old_at] = old["reserved_accounts"] + db["accounts"]["account_types"].get(old_at, [])
        db["sessions"][str(uid)] = {"state": "waiting_for_quantity", "account_type": at, "price": price, "available_count": len(pool), "started_at": int(time.time() * 1000)}
        qty_btns = [{"text": str(i + 1), "callback_data": f"qty:{type_callback_id(at)}:{i + 1}"} for i in range(min(len(pool), 25))]
        rows: list = [qty_btns[i:i + 5] for i in range(0, len(qty_btns), 5)] + [[{"text": "🚫 បោះបង់", "callback_data": "cancel_buy"}]]
        if msg_id: await edit_message_text(chat_id, msg_id, f"<b>សូមជ្រើសរើសចំនួនដែលចង់ទិញ៖</b>\n\nប្រភេទ៖ {esc(at)} – តម្លៃ ${price} ក្នុងមួយ", {"inline_keyboard": rows})
        else: await send_message(chat_id, "<b>សូមជ្រើសរើសចំនួនដែលចង់ទិញ៖</b>", {"inline_keyboard": rows})
        return

    if data.startswith("qty:"):
        parts = data.split(":")
        at  = type_from_cb_id(ctx, parts[1]) if len(parts) == 3 else None
        qty = int(parts[2]) if len(parts) == 3 else int(parts[1]) if len(parts) == 2 else 0
        if not qty or qty < 1: await answer_callback_query(cb["id"]); return
        sess = db["sessions"].get(str(uid))
        if not sess or sess.get("state") != "waiting_for_quantity": await answer_callback_query(cb["id"]); return
        if at and sess.get("account_type") != at: await answer_callback_query(cb["id"], "ប្រភេទផ្លាស់ប្ដូរ — ចាប់ផ្ដើមម្ដងទៀត", True); return
        if qty > (sess.get("available_count") or 0): await answer_callback_query(cb["id"], f"សុំទោស! មានត្រឹមតែ {sess.get('available_count')} នៅក្នុងស្តុក", True); return
        sess["quantity"] = qty; sess["total_price"] = round(qty * (sess.get("price") or 0) * 100) / 100
        if msg_id: asyncio.create_task(delete_message(chat_id, msg_id))
        await start_payment_for_session(ctx, chat_id, uid, sess, cb["id"]); return

    if data == "cancel_buy":
        await answer_callback_query(cb["id"])
        sess = db["sessions"].get(str(uid))
        if sess and sess.get("reserved_accounts") and sess.get("account_type"):
            at = sess["account_type"]
            db["accounts"]["account_types"][at] = sess["reserved_accounts"] + db["accounts"]["account_types"].get(at, [])
        db["sessions"].pop(str(uid), None)
        if msg_id: asyncio.create_task(delete_message(chat_id, msg_id))
        await show_account_selection(ctx, chat_id); return

    if data == "cancel_purchase":
        sess   = db["sessions"].get(str(uid))
        txn_id = sess.get("transaction_id") if sess else None
        if txn_id:
            try:
                result = await check_khpay_status(ctx["CAMBO_API_TOKEN"], txn_id, sess.get("md5"))
                if result["paid"]: await answer_callback_query(cb["id"], "✅ បានទទួលការបង់ប្រាក់!"); await deliver_accounts(ctx, chat_id, uid, sess, result.get("data")); return
            except: pass
        await answer_callback_query(cb["id"])
        if sess:
            at = sess.get("account_type"); reserved = sess.get("reserved_accounts", [])
            if reserved and at: db["accounts"]["account_types"][at] = reserved + db["accounts"]["account_types"].get(at, [])
            for k in ["photo_message_id", "qr_message_id"]:
                if mid := sess.get(k): asyncio.create_task(delete_message(chat_id, mid))
            db["sessions"].pop(str(uid), None)
        await show_account_selection(ctx, chat_id); return

    if data == "check_payment":
        sess   = db["sessions"].get(str(uid))
        txn_id = sess.get("transaction_id") if sess else None
        if not txn_id: await answer_callback_query(cb["id"], "⚠️ រកមិនឃើញការទូទាត់", True); return
        await answer_callback_query(cb["id"], "⏳ កំពុងពិនិត្យ…")
        try:
            result = await check_khpay_status(ctx["CAMBO_API_TOKEN"], txn_id, sess.get("md5") if sess else None)
            if result["paid"]: await deliver_accounts(ctx, chat_id, uid, sess, result.get("data"))
            else: await answer_callback_query(cb["id"], "❌ មិនទាន់បង់ប្រាក់ទេ", True)
        except Exception as e: await answer_callback_query(cb["id"], f"❌ មានបញ្ហា: {e}", True)
        return

    if data.startswith("dts:") and is_admin(ctx, uid):
        type_name = type_from_cb_id(ctx, data[4:]) or data[4:]
        if type_name not in db["accounts"]["account_types"]: await answer_callback_query(cb["id"], "ប្រភេទនេះមិនមានទៀតហើយ!", True); return
        await answer_callback_query(cb["id"])
        count = len(db["accounts"]["account_types"][type_name]); price = db["accounts"]["prices"].get(type_name, 0)
        await send_message(chat_id, f"⚠️ <b>តើអ្នកពិតជាចង់លុបប្រភេទ គូប៉ុង នេះមែនទេ?</b>\n\n<blockquote>🔹 ប្រភេទ: {esc(type_name)}\n🔹 ចំនួន: {count}\n🔹 តម្លៃ: ${price}</blockquote>",
            {"inline_keyboard": [[{"text": "✅ បញ្ជាក់លុប", "callback_data": f"dtc:{type_callback_id(type_name)}"}, {"text": "🚫 បោះបង់", "callback_data": "dtcancel"}]]}); return

    if data.startswith("dtc:") and is_admin(ctx, uid):
        type_name = type_from_cb_id(ctx, data[4:]) or data[4:]
        if type_name not in db["accounts"]["account_types"]: await answer_callback_query(cb["id"], "ប្រភេទនេះមិនមានទៀតហើយ!", True); return
        await answer_callback_query(cb["id"])
        count = len(db["accounts"]["account_types"].get(type_name, []))
        db["accounts"]["account_types"].pop(type_name, None); db["accounts"]["prices"].pop(type_name, None)
        if msg_id: asyncio.create_task(delete_message(chat_id, msg_id))
        await send_message(chat_id, f"✅ <b>បានលុប <code>{esc(type_name)}</code> ចំនួន {count} records!</b>"); return

    if data == "dtcancel" and is_admin(ctx, uid):
        await answer_callback_query(cb["id"])
        if msg_id: asyncio.create_task(delete_message(chat_id, msg_id))
        await send_message(chat_id, "🚫 <b>បានបោះបង់ការលុប</b>"); return

    await answer_callback_query(cb["id"])

async def handle_update(update: dict, pre_db: dict | None = None) -> None:
    db  = pre_db if pre_db is not None else await load_db()
    ctx = load_ctx(db)
    try:
        if update.get("channel_post"):    await handle_channel_post(ctx, update["channel_post"])
        elif update.get("callback_query"): await handle_callback(ctx, update["callback_query"])
        elif update.get("message"):        await handle_message(ctx, update["message"])
    except Exception as e:
        print(f"[BotError] {e}")
    save_task = asyncio.create_task(save_db(ctx["db"]))
    if any(s.get("state") == "payment_pending" for s in ctx["db"]["sessions"].values()):
        asyncio.create_task(run_watchdog())
    await save_task

# ============= Webhook secret =============

def _derive_webhook_secret(api_key: str) -> str:
    digest = hashlib.sha256(f"telegram-webhook:{api_key}".encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")

def _safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())

async def handle_webhook_request(body: bytes, secret_token: str) -> dict:
    api_key = os.environ.get("TELEGRAM_API_KEY")
    if not api_key: return {"status": 500, "body": "Server misconfigured"}
    if not _safe_equal(secret_token, _derive_webhook_secret(api_key)): return {"status": 401, "body": "Unauthorized"}
    try: update = json.loads(body)
    except: return {"status": 400, "body": "Bad request"}
    if not isinstance(update.get("update_id"), int): return {"status": 200, "body": {"ok": True, "ignored": True}}
    async def work():
        try:
            fresh, db = await asyncio.gather(mark_update_processed(update["update_id"]), load_db())
            if not fresh: return
            await handle_update(update, db)
            asyncio.create_task(run_watchdog())
        except Exception as e:
            print(f"[webhook] bg error: {e}")
    asyncio.create_task(work())
    return {"status": 200, "body": {"ok": True}}

async def handle_cron_request() -> dict:
    max_ms = 59_000; interval_ms = 500; start = time.time() * 1000; runs = 0
    while (time.time() * 1000) - start < max_ms:
        try: await run_watchdog()
        except Exception as e: print(f"[cron] watchdog error: {e}")
        runs += 1
        if (time.time() * 1000) - start + interval_ms >= max_ms: break
        await asyncio.sleep(interval_ms / 1000)
    return {"status": 200, "body": {"ok": True, "runs": runs}}

# ============= FastAPI App =============

@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/", response_class=HTMLResponse)
async def index():
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Telegram Bot</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fcfbf8;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:white;border-radius:16px;padding:40px 48px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:420px;width:90%}
    .icon{font-size:52px;margin-bottom:16px}
    h1{font-size:24px;color:#1a1a1a;margin-bottom:8px}
    p{font-size:15px;color:#666;line-height:1.6}
    .badge{display:inline-block;margin-top:20px;background:#e8f5e9;color:#2e7d32;border-radius:999px;padding:6px 18px;font-size:13px;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🤖</div>
    <h1>Telegram Bot</h1>
    <p>Coupon selling bot with KhPay payment integration.<br/>Webhook and cron endpoints are active.</p>
    <div class="badge">✅ Server running</div>
  </div>
</body>
</html>"""

@app.post("/api/public/telegram/webhook")
@app.post("/api/webhook")
async def telegram_webhook(request: Request):
    body         = await request.body()
    secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    result       = await handle_webhook_request(body, secret_token)
    return JSONResponse(content=result["body"], status_code=result["status"])

@app.get("/api/public/telegram/cron")
@app.post("/api/public/telegram/cron")
async def telegram_cron():
    try:
        result = await handle_cron_request()
        return JSONResponse(content=result["body"], status_code=result["status"])
    except Exception as e:
        return JSONResponse(content={"ok": False, "error": str(e)}, status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), reload=False)
