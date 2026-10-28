import { chromium } from "playwright";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().includes("ship.pirateship.com"));
    console.log("Current page:", page.url(), "Title:", await page.title());

    // 1. Click vào dropdown preset để chọn "Amazon - 16x28 - 72 Pack"
    const customDropdown = page.locator("[role='combobox']").filter({ hasText: /Amazon|Saved Package/ });
    if (await customDropdown.count() > 0) {
      console.log("Clicking custom dropdown...");
      await customDropdown.first().click();
      await page.waitForTimeout(1000);
      const option72 = page.locator("text=Amazon - 16x28 - 72 Pack");
      if (await option72.count() > 0) {
        console.log("Clicking 72-pack option...");
        await option72.first().click();
        await page.waitForTimeout(1000);
      }
    } else {
      console.log("Dispatching change event on select...");
      await page.evaluate(() => {
        const sel = document.querySelector("select[name='packagePreset.shipmentPresetId']");
        if (sel) {
          sel.value = "414979690";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await page.waitForTimeout(1000);
    }

    // 2. Click Get Rates
    console.log("Clicking Get Rates...");
    const getRatesBtn = page.locator("button:has-text('Get Rates')");
    await getRatesBtn.click();
    await page.waitForTimeout(6000);

    console.log("Current URL after Get Rates:", page.url(), "Title:", await page.title());
    await page.screenshot({ path: "/data/rates_table.png", fullPage: true });
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
