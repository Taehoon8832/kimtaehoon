/**
 * GitHub Actions용: 브라우저 동일출처 fetch로 진학프로 Cloudflare 우회
 * Usage: node scripts/scrape_recruit_playwright.mjs [/tmp/recruit-api.json]
 */
import fs from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] || "/tmp/recruit-api.json";
const LIST = "https://www.jinhakpro.com/recruit/list";
const API =
  "/api/applicant/recruit/sub-list?isOnlyOnlineApply=false&bookmarkSortType=1&majorCategoryCode=&sortType=1";

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});

try {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "ko-KR",
  });
  await page.goto(LIST, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async (apiPath) => {
    const res = await fetch(apiPath, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text.slice(0, 2000000) };
  }, API);

  if (!result.ok) throw new Error(`playwright_http_${result.status}`);
  if (/just a moment|cloudflare|cf-browser-verification/i.test(result.text)) {
    throw new Error("playwright_cloudflare");
  }
  const data = JSON.parse(result.text);
  if (!Array.isArray(data) || !data.length) throw new Error("playwright_empty");
  if (!data[0]?.recruitIdx) throw new Error("playwright_shape");
  fs.writeFileSync(OUT, JSON.stringify(data), "utf8");
  console.log(`playwright wrote ${data.length} → ${OUT}`);
} finally {
  await browser.close();
}
