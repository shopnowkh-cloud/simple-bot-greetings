import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from bot import handle_webhook_request, handle_cron_request, get_pool


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
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Telegram Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fcfbf8;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px 48px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 52px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #1a1a1a; margin-bottom: 8px; }
    p  { font-size: 15px; color: #666; line-height: 1.6; }
    .badge {
      display: inline-block;
      margin-top: 20px;
      background: #e8f5e9;
      color: #2e7d32;
      border-radius: 999px;
      padding: 6px 18px;
      font-size: 13px;
      font-weight: 600;
    }
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
async def telegram_webhook(request: Request):
    body = await request.body()
    secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    result = await handle_webhook_request(body, secret_token)
    return JSONResponse(content=result["body"], status_code=result["status"])


@app.get("/api/public/telegram/cron")
@app.post("/api/public/telegram/cron")
async def telegram_cron():
    try:
        result = await handle_cron_request()
        return JSONResponse(content=result["body"], status_code=result["status"])
    except Exception as e:
        return JSONResponse(content={"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/webhook")
async def webhook_alias(request: Request):
    body = await request.body()
    secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    result = await handle_webhook_request(body, secret_token)
    return JSONResponse(content=result["body"], status_code=result["status"])


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
