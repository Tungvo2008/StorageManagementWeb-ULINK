#!/usr/bin/env python3
"""
pirateship_buy_batch.py
=============================================================================
Autonomous Pirate Ship Batch Purchase CLI & Tool
- 100% SHA-256 Persisted GraphQL Integration & CDP Browser Automation
- Tự động đồng bộ cookie sống từ CDP browser (port 9226) nếu cookie hết hạn
- Hỗ trợ tra cứu số dư tài khoản (--balance)
- Ép đồng bộ cookie (--sync-cookies)
- Tự động hóa mua nhãn hàng loạt từ file Excel (--file <path.xlsx>)
- Tự động cập nhật SQLite storage.db (--cargo-batch-id <id>)
- Tự động gửi PDF và mã Tracking qua Telegram cho Tùng (--notify-telegram)
=============================================================================
"""

import argparse
import datetime
import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pirateship_buy_batch")

# Các đường dẫn chuẩn
BASE_DIR = Path("/home/thanhtung/scripts")
HASHES_FILE = BASE_DIR / "pirateship_hashes.json"
COOKIE_FILE = BASE_DIR / "pirateship.cookie"
TMP_COOKIE_FILE = Path("/tmp/pirateship.cookie")
STORAGE_DB_PATH = Path("/home/thanhtung/StorageManagementWeb-ULINK/backend/storage.db")

CONTAINER_BROWSER = "pirateship-agent-service-pirateship-browser-1"
CDP_URL = "http://127.0.0.1:9226"

DEFAULT_WAREHOUSE_ID = "4324373"       # U-live llc (141 Carondelet Plz)
DEFAULT_PRESET_ID = "414979690"        # Amazon - 16x28 - 72 Pack
TUNG_TELEGRAM_ID = "8151613595"

GRAPHQL_ENDPOINT = "https://ship.pirateship.com/api/graphql"


def load_hashes() -> Dict[str, str]:
    if not HASHES_FILE.exists():
        # Thử lấy từ container
        try:
            cmd = ["docker", "exec", CONTAINER_BROWSER, "cat", "/data/pirateship_hashes.json"]
            raw = subprocess.check_output(cmd, text=True)
            HASHES_FILE.write_text(raw)
        except Exception as e:
            logger.error(f"Không thể đọc hashes: {e}")
            return {}
    try:
        return json.loads(HASHES_FILE.read_text())
    except Exception as e:
        logger.error(f"Lỗi đọc {HASHES_FILE}: {e}")
        return {}


def sync_cookies_from_browser() -> str:
    """Đồng bộ cookie sống từ Chromium CDP vào file cookie host và tmp."""
    logger.info("Đang trích xuất cookie từ trình duyệt qua CDP...")
    node_script = """
const WebSocket = require("/opt/session-sync/node_modules/playwright-core/lib/utilsBundle").ws;
const http = require("http");
const fs = require("fs");

(async () => {
  const version = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9226/json/version", res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  ws.on("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Storage.getCookies" }));
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id === 1) {
      const cookies = (msg.result && msg.result.cookies) || [];
      const relevant = cookies.filter(c => c.domain.endsWith("pirateship.com"));
      const cookieStr = relevant.map(c => `${c.name}=${c.value}`).join("; ");
      fs.writeFileSync("/data/pirateship.cookie", cookieStr, { mode: 0o600 });
      process.stdout.write(cookieStr);
      ws.close();
      process.exit(0);
    }
  });
})();
"""
    try:
        cmd = ["docker", "exec", "-i", "-w", "/opt/session-sync", CONTAINER_BROWSER, "node", "-e", node_script]
        cookie_str = subprocess.check_output(cmd, text=True, timeout=20).strip()
        if cookie_str:
            COOKIE_FILE.write_text(cookie_str)
            TMP_COOKIE_FILE.write_text(cookie_str)
            COOKIE_FILE.chmod(0o600)
            TMP_COOKIE_FILE.chmod(0o600)
            logger.info(f"Đã lưu cookie mới ({len(cookie_str)} bytes) vào {COOKIE_FILE} và {TMP_COOKIE_FILE}")
            return cookie_str
    except Exception as e:
        logger.warning(f"Không thể sync cookie qua node script: {e}")

    # Fallback: đọc từ container trực tiếp nếu có sẵn
    try:
        cmd = ["docker", "exec", CONTAINER_BROWSER, "cat", "/data/pirateship.cookie"]
        cookie_str = subprocess.check_output(cmd, text=True, timeout=10).strip()
        if cookie_str:
            COOKIE_FILE.write_text(cookie_str)
            TMP_COOKIE_FILE.write_text(cookie_str)
            return cookie_str
    except Exception:
        pass

    if COOKIE_FILE.exists():
        return COOKIE_FILE.read_text().strip()
    return ""


def get_cookie(force_refresh: bool = False) -> str:
    if not force_refresh and COOKIE_FILE.exists():
        c = COOKIE_FILE.read_text().strip()
        if c:
            return c
    return sync_cookies_from_browser()


def graphql_persisted_query(operation_name: str, variables: Dict[str, Any] = None) -> Dict[str, Any]:
    """Gọi GraphQL Pirate Ship bằng SHA-256 Persisted Query."""
    hashes = load_hashes()
    sha256 = hashes.get(operation_name)
    if not sha256:
        raise ValueError(f"Không tìm thấy SHA-256 hash cho operation: {operation_name}")

    cookie = get_cookie()
    url = f"{GRAPHQL_ENDPOINT}?opname={urllib.parse.quote(operation_name)}"
    payload = {
        "operationName": operation_name,
        "variables": variables or {},
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": sha256
            }
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": cookie,
            "Origin": "https://ship.pirateship.com",
            "Referer": "https://ship.pirateship.com/ship",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("errors"):
                err_msg = "; ".join(str(e.get("message", e)) for e in data["errors"])
                if "unauthenticated" in err_msg.lower() or "logged in" in err_msg.lower():
                    logger.warning("Cookie hết hạn, thử refresh lại...")
                    sync_cookies_from_browser()
                    return graphql_persisted_query(operation_name, variables)
                raise RuntimeError(f"GraphQL Errors in {operation_name}: {err_msg}")
            return data.get("data") or {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code} on {operation_name}: {body}")


def get_account_balance() -> Dict[str, Any]:
    """Tra cứu số dư tài khoản Pirate Ship."""
    try:
        data = graphql_persisted_query("BatchQuery", {"id": "635817622"})
        company = data.get("company") or {}
        user = data.get("user") or {}
        balance = company.get("accountBalance")
        payment_sources = company.get("paymentSources") or []
        default_payment = payment_sources[0] if payment_sources else {}
        return {
            "ok": True,
            "company": company.get("title", "U-live llc"),
            "accountBalance": balance,
            "user": f"{user.get('firstName', '')} {user.get('lastName', '')} ({user.get('email', '')})".strip(),
            "defaultCard": f"{default_payment.get('brand')} ending in {default_payment.get('last4')}" if default_payment else "None"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def upload_and_process_batch_cdp(excel_path: Path, preset_id: str = DEFAULT_PRESET_ID) -> Dict[str, Any]:
    """Sử dụng Playwright qua CDP để upload file spreadsheet và hoàn tất mua nhãn."""
    filename = excel_path.name
    remote_excel = f"/tmp/{filename}"

    # 1. Copy file vào container
    logger.info(f"Copying {excel_path} -> {CONTAINER_BROWSER}:{remote_excel}...")
    subprocess.run(["docker", "cp", str(excel_path), f"{CONTAINER_BROWSER}:{remote_excel}"], check=True)

    # 2. Tạo kịch bản Playwright CDP
    js_flow = f"""
import {{ chromium }} from "playwright";
import fs from "fs";

(async () => {{
  const browser = await chromium.connectOverCDP("{CDP_URL}");
  try {{
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().includes("ship.pirateship.com")) || context.pages()[0];
    
    // Mở trang Ship Overview
    await page.goto("https://ship.pirateship.com/ship", {{ waitUntil: "networkidle" }});

    // Bấm Upload a Spreadsheet
    const uploadBtn = page.locator("text=Upload a Spreadsheet");
    await uploadBtn.click();
    await page.waitForTimeout(3000);

    const fileInput = await page.$("input[type=\\"file\\"]");
    if (!fileInput) throw new Error("Không tìm thấy ô upload file");
    await fileInput.setInputFiles("{remote_excel}");
    await page.waitForTimeout(5000);

    // Bấm Confirm Mapping
    const confirmBtn = page.locator("button:has-text(\\"Confirm Mapping\\")");
    if (await confirmBtn.count() > 0) {{
      await confirmBtn.click();
      await page.waitForTimeout(4000);
    }}

    // Chọn Preset thùng hàng 72-pack
    await page.evaluate((pid) => {{
      const sel = document.querySelector("select[name=\\"packagePreset.shipmentPresetId\\"]");
      if (sel) {{
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(sel, pid);
        sel.dispatchEvent(new Event("input", {{ bubbles: true }}));
        sel.dispatchEvent(new Event("change", {{ bubbles: true }}));
      }}
    }}, "{preset_id}");
    await page.waitForTimeout(1000);

    // Bấm Get Rates
    const getRatesBtn = page.locator("button:has-text(\\"Get Rates\\")");
    await getRatesBtn.click();
    await page.waitForTimeout(6000);

    // Bấm Buy Labels
    const buyBtn = page.locator("button:has-text(\\"Buy Labels\\")");
    await buyBtn.click();
    await page.waitForTimeout(15000);

    // Lấy thông tin kết quả
    const pageText = await page.innerText("body");
    const trackings = [...new Set(pageText.match(/1Z[0-9A-Z]{{16}}/g) || [])];
    
    const batchIdMatch = page.url().match(/batch\\/(\\d+)/);
    const batchId = batchIdMatch ? batchIdMatch[1] : null;

    // Lấy download PDF link
    let pdfUrl = null;
    const printBtn = page.locator("button:has-text(\\"Print Labels\\"), a:has-text(\\"Print Labels\\")");
    if (await printBtn.count() > 0) {{
      await printBtn.first().click();
      await page.waitForTimeout(6000);
    }}

    const pdfLinks = await page.$$eval("a[href*=\\".pdf\\"], iframe[src*=\\".pdf\\"]", els => els.map(e => e.href || e.src));
    if (pdfLinks.length > 0) {{
      pdfUrl = pdfLinks.find(u => u.includes("/force/1/")) || pdfLinks[0];
    }}

    if (pdfUrl) {{
      const cookie = fs.readFileSync("/data/pirateship.cookie", "utf8").trim();
      const resp = await fetch(pdfUrl, {{
        headers: {{
          "Cookie": cookie,
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
        }}
      }});
      if (resp.ok) {{
        const buf = await resp.arrayBuffer();
        fs.writeFileSync("/tmp/downloaded_batch_labels.pdf", Buffer.from(buf));
      }}
    }}

    console.log(JSON.stringify({{
      ok: true,
      batchId: batchId,
      batchUrl: page.url(),
      trackings: trackings,
      hasPdf: fs.existsSync("/tmp/downloaded_batch_labels.pdf")
    }}));

  }} finally {{
    await browser.close();
  }}
}})().catch(err => {{
  console.log(JSON.stringify({{ ok: false, error: err.message }}));
  process.exit(1);
}});
"""
    runner_path = "/tmp/runner_buy_batch.mjs"
    p = subprocess.Popen(["docker", "exec", "-i", CONTAINER_BROWSER, "sh", "-c", f"cat > {runner_path}"], stdin=subprocess.PIPE, text=True)
    p.communicate(input=js_flow)

    logger.info("Đang chạy automation mua nhãn qua Chrome CDP...")
    res = subprocess.run(["docker", "exec", "-i", "-w", "/opt/session-sync", CONTAINER_BROWSER, "node", runner_path], capture_output=True, text=True, timeout=120)
    
    lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip().startswith("{")]
    if not lines:
        return {"ok": False, "error": f"Lỗi không nhận được JSON từ Playwright: {res.stderr or res.stdout}"}

    return json.loads(lines[-1])


def update_cargo_db(batch_id: int, trackings: List[str]):
    """Cập nhật mã tracking cho các thùng trong batch và chuyển trạng thái SHIPPED."""
    if not STORAGE_DB_PATH.exists():
        logger.warning(f"Không tìm thấy DB tại {STORAGE_DB_PATH}")
        return False

    conn = sqlite3.connect(str(STORAGE_DB_PATH))
    c = conn.cursor()
    try:
        # Lấy danh sách box theo batch_id sắp xếp theo id hoặc box_code
        c.execute("SELECT id, box_code FROM cargo_boxes WHERE batch_id = ? ORDER BY id ASC", (batch_id,))
        boxes = c.fetchall()
        logger.info(f"Tìm thấy {len(boxes)} thùng thuộc Batch {batch_id}: {boxes}")

        for i, box in enumerate(boxes):
            if i < len(trackings):
                tr = trackings[i]
                c.execute("UPDATE cargo_boxes SET tracking_number = ? WHERE id = ?", (tr, box[0]))
                logger.info(f"Cập nhật thùng {box[1]} (ID: {box[0]}) -> Tracking: {tr}")

        c.execute("UPDATE cargo_batches SET status = 'SHIPPED', updated_at = datetime('now') WHERE id = ?", (batch_id,))
        conn.commit()
        logger.info(f"Đã cập nhật trạng thái Batch {batch_id} -> SHIPPED")
        return True
    except Exception as e:
        logger.error(f"Lỗi cập nhật SQLite: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def send_telegram_notification(text: str, pdf_path: Optional[str] = None):
    """Gửi thông báo và file PDF qua Telegram cho Tùng."""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        # Đọc từ /app/.env
        for env_file in [Path("/app/.env"), Path("/home/thanhtung/assistant/.env")]:
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    if line.startswith("TELEGRAM_BOT_TOKEN="):
                        bot_token = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            if bot_token:
                break

    if not bot_token:
        logger.warning("Không tìm thấy TELEGRAM_BOT_TOKEN để gửi tin")
        return False

    url_msg = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": TUNG_TELEGRAM_ID,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        req = urllib.request.Request(
            url_msg,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=15)
        logger.info(f"Đã gửi tin nhắn Telegram tới {TUNG_TELEGRAM_ID}")
    except Exception as e:
        logger.error(f"Lỗi gửi tin nhắn Telegram: {e}")

    # Gửi file PDF nếu có
    if pdf_path and Path(pdf_path).exists():
        url_doc = f"https://api.telegram.org/bot{bot_token}/sendDocument"
        boundary = "----tg-" + os.urandom(8).hex()
        pdf_bytes = Path(pdf_path).read_bytes()
        pdf_name = Path(pdf_path).name

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="chat_id"\r\n\r\n{TUNG_TELEGRAM_ID}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="caption"\r\n\r\nNhãn in nhiệt 4x6 inch ({pdf_name})\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="document"; filename="{pdf_name}"\r\n'
            f"Content-Type: application/pdf\r\n\r\n"
        ).encode("utf-8") + pdf_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        try:
            req_doc = urllib.request.Request(
                url_doc,
                data=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
            )
            urllib.request.urlopen(req_doc, timeout=30)
            logger.info(f"Đã gửi tệp PDF Telegram tới {TUNG_TELEGRAM_ID}")
        except Exception as e:
            logger.error(f"Lỗi gửi tài liệu Telegram: {e}")

    return True


def main():
    parser = argparse.ArgumentParser(description="Pirate Ship Autonomous Batch Purchase CLI (Persisted GraphQL & CDP)")
    parser.add_argument("--file", "-f", help="Đường dẫn file Excel danh sách thùng (.xlsx)")
    parser.add_argument("--output", "-o", help="Đường dẫn lưu file PDF nhãn (mặc định cùng thư mục file Excel)")
    parser.add_argument("--preset", "-p", default=DEFAULT_PRESET_ID, help=f"Preset ID (mặc định: {DEFAULT_PRESET_ID})")
    parser.add_argument("--cargo-batch-id", "-b", type=int, help="Cập nhật tracking vào cargo_boxes và set SHIPPED cho batch_id trong storage.db")
    parser.add_argument("--notify-telegram", action="store_true", help="Gửi file PDF và thông báo tracking qua Telegram Bot cho Tùng")
    parser.add_argument("--balance", action="store_true", help="Tra cứu số dư tài khoản Pirate Ship")
    parser.add_argument("--sync-cookies", action="store_true", help="Ép đồng bộ cookie từ browser CDP")

    args = parser.parse_args()

    # 1. Ép sync cookies
    if args.sync_cookies:
        c = sync_cookies_from_browser()
        print(json.dumps({"ok": bool(c), "cookieLength": len(c)}, indent=2))
        return

    # 2. Tra cứu số dư
    if args.balance:
        bal = get_account_balance()
        print(json.dumps(bal, indent=2, ensure_ascii=False))
        return

    # 3. Mua nhãn hàng loạt
    if not args.file:
        parser.print_help()
        sys.exit(1)

    excel_file = Path(args.file)
    if not excel_file.exists():
        print(json.dumps({"ok": False, "error": f"File không tồn tại: {args.file}"}, indent=2))
        sys.exit(1)

    output_pdf = Path(args.output) if args.output else excel_file.parent / f"{excel_file.stem}-UPS.pdf"

    logger.info(f"Bắt đầu quy trình mua nhãn cho file: {excel_file}")
    result = upload_and_process_batch_cdp(excel_file, args.preset)

    if not result.get("ok"):
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(1)

    # Copy PDF về host nếu container đã tải
    if result.get("hasPdf"):
        subprocess.run(["docker", "cp", f"{CONTAINER_BROWSER}:/tmp/downloaded_batch_labels.pdf", str(output_pdf)], check=True)
        result["pdfPath"] = str(output_pdf)
        logger.info(f"Đã lưu file PDF: {output_pdf}")

    trackings = result.get("trackings") or []

    # 4. Cập nhật SQLite nếu có chỉ định cargo-batch-id
    if args.cargo_batch_id:
        db_ok = update_cargo_db(args.cargo_batch_id, trackings)
        result["cargoDbUpdated"] = db_ok

    # 5. Gửi thông báo Telegram nếu được yêu cầu
    if args.notify_telegram:
        lines = [
            "🚢 <b>PIRATE SHIP - HOÀN TẤT MUA NHÃN BATCH</b>",
            f"• <b>Mã Batch</b>: <code>{result.get('batchId', 'N/A')}</code>",
            f"• <b>Số lượng nhãn</b>: {len(trackings)} thùng (UPS Ground)",
            f"• <b>Danh sách Tracking</b>:"
        ]
        for i, tr in enumerate(trackings, start=1):
            lines.append(f"  {i}. <code>{tr}</code>")
        if args.cargo_batch_id:
            lines.append(f"• <b>Trust Cargo Batch ID</b>: #{args.cargo_batch_id} (Đã set SHIPPED)")

        send_telegram_notification("\n".join(lines), str(output_pdf) if output_pdf.exists() else None)
        result["telegramSent"] = True

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
