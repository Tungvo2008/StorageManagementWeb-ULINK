import { chromium } from "playwright";

async function solveAndLogin() {
  console.log("[AutoLogin] Connecting to Chrome CDP at http://127.0.0.1:9226...");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9226");
  try {
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().includes("ship.pirateship.com"));
    if (!page) {
      console.log("[AutoLogin] No Pirate Ship page found, using first page...");
      page = context.pages()[0];
      await page.goto("https://ship.pirateship.com/", { waitUntil: "domcontentloaded" });
    }

    console.log("[AutoLogin] Current URL:", page.url(), "Title:", await page.title());

    // 1. Điền thông tin đăng nhập trước
    const emailInput = await page.$("input[name=\"email\"]");
    if (emailInput) {
      console.log("[AutoLogin] Filling email...");
      await emailInput.fill("ulive.llc2020@gmail.com");
      await page.waitForTimeout(500);

      console.log("[AutoLogin] Filling password...");
      await page.fill("input[name=\"password\"]", "shipfast2022");
      await page.waitForTimeout(500);

      const remember = await page.$("input[name=\"remember\"]");
      if (remember && !(await remember.isChecked())) {
        console.log("[AutoLogin] Checking Remember me...");
        await remember.check();
        await page.waitForTimeout(500);
      }
    }

    // 2. Tương tác với Cloudflare Turnstile bằng cách click trực tiếp vào tọa độ widget
    console.log("[AutoLogin] Clicking Turnstile widget at coordinates (485, 500)...");
    await page.mouse.move(485, 500);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();

    console.log("[AutoLogin] Waiting 6s for Turnstile verification...");
    await page.waitForTimeout(6000);

    console.log("[AutoLogin] Waiting 5s for Turnstile to verify...");
    await page.waitForTimeout(5000);

    // 3. Click Submit
    console.log("[AutoLogin] Clicking submit button...");
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      console.log("[AutoLogin] No submit button found, trying Enter...");
      await page.keyboard.press("Enter");
    }

    console.log("[AutoLogin] Waiting 8s for navigation / dashboard load...");
    await page.waitForTimeout(8000);

    console.log("[AutoLogin] Final URL:", page.url(), "Title:", await page.title());
    await page.screenshot({ path: "/tmp/login_result.png", fullPage: true });
    console.log("[AutoLogin] Screenshot saved to /tmp/login_result.png");

  } finally {
    await browser.close();
  }
}

solveAndLogin().catch(err => {
  console.error("[AutoLogin Error]:", err);
  process.exit(1);
});
