import { chromium } from "playwright";
import fs from "fs";

async function buyAndDownload() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().includes("ship.pirateship.com"));
    console.log("Current page:", page.url(), "Title:", await page.title());

    // 1. Click nút Buy Labels
    console.log("Clicking 'Buy Labels'...");
    const buyBtn = page.locator("button:has-text('Buy Labels')");
    await buyBtn.click();

    console.log("Waiting 15s for purchase completion...");
    await page.waitForTimeout(15000);
    console.log("URL after purchase:", page.url(), "Title:", await page.title());

    // 2. Chụp ảnh xác nhận sau khi mua
    await page.screenshot({ path: "/data/after_buy_batch.png", fullPage: true });

    // 3. Đọc nội dung trang để lấy thông tin tracking & in nhãn
    const pageText = await page.innerText("body");
    console.log("Page snippet after buy:", pageText.slice(0, 1500));

    // Tìm tất cả mã tracking dạng 1Z...
    const trackingMatches = pageText.match(/1Z[0-9A-Z]{16}/g) || [];
    const uniqueTrackings = [...new Set(trackingMatches)];
    console.log("FOUND TRACKINGS:", uniqueTrackings);

    // 4. Tìm nút Download / Print Labels để tải file PDF
    console.log("Looking for print / download label button...");
    const printBtn = page.locator("button:has-text('Print Labels'), a:has-text('Print Labels'), button:has-text('Download Labels'), a:has-text('Download Labels')");
    if (await printBtn.count() > 0) {
      console.log("Found print/download button, clicking...");
      await printBtn.first().click();
      await page.waitForTimeout(8000);
    }

    // Kiểm tra xem có popup hoặc link PDF trực tiếp không
    const pdfLinks = await page.$$eval("a[href*='.pdf'], iframe[src*='.pdf']", els => els.map(e => e.href || e.src));
    console.log("PDF Links found:", pdfLinks);

    await page.screenshot({ path: "/data/label_ready.png", fullPage: true });
  } finally {
    await browser.close();
  }
}

buyAndDownload().catch(console.error);
