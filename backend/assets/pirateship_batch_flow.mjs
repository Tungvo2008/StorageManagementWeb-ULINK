import { chromium } from "playwright";
import fs from "fs";

const CDP_URL = "http://127.0.0.1:9226";
const SPREADSHEET_PATH = "/tmp/pirateship-CARGO-20261026-WORL-3boxes.xlsx";
const OUTPUT_PDF_PATH = "/tmp/pirateship-CARGO-20261026-WORL-3boxes-UPS.pdf";

export async function run() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().includes("ship.pirateship.com")) || context.pages()[0];
    
    console.log("[PirateShip Flow] Current URL:", page.url(), "Title:", await page.title());
    if (page.url().includes("/login") || (await page.title()).toLowerCase().includes("log in")) {
      throw new Error("Trình duyệt chưa đăng nhập Pirate Ship! Vui lòng đăng nhập qua noVNC port 6084.");
    }

    console.log("[PirateShip Flow] Navigating to https://ship.pirateship.com/ship...");
    await page.goto("https://ship.pirateship.com/ship", { waitUntil: "networkidle" });

    console.log("[PirateShip Flow] Opening spreadsheet upload page...");
    await page.goto("https://ship.pirateship.com/upload", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    console.log("[PirateShip Flow] Uploading file:", SPREADSHEET_PATH);
    const fileInput = await page.$("input[type=\"file\"]");
    if (!fileInput) throw new Error("Could not find file input on /upload page");
    await fileInput.setInputFiles(SPREADSHEET_PATH);

    console.log("[PirateShip Flow] File submitted, waiting for upload/mapping page...");
    await page.waitForTimeout(5000);

    // Xử lý màn hình mapping / confirm
    console.log("[PirateShip Flow] Confirming column mappings...");
    const confirmBtn = await page.$("button:has-text('Confirm Mapping'), button:has-text('Continue'), button:has-text('Save')");
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(4000);
    }

    console.log("[PirateShip Flow] Current batch URL:", page.url());
  } finally {
    await browser.close();
  }
}

if (process.argv[1].endsWith("pirateship_batch_flow.mjs")) {
  run().catch(console.error);
}
