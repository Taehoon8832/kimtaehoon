/**
 * GitHub Actions용: 브라우저로 진학프로 Cloudflare 통과 후 목록 수집
 * Usage: node scripts/scrape_recruit_playwright.mjs [/tmp/recruit-api.json]
 */
import fs from "node:fs";
import { chromium, firefox } from "playwright";

const OUT = process.argv[2] || "/tmp/recruit-api.json";
const LIST = "https://www.jinhakpro.com/recruit/list";
const API =
  "/api/applicant/recruit/sub-list?isOnlyOnlineApply=false&bookmarkSortType=1&majorCategoryCode=&sortType=1";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseNuxtItems(html) {
  const m = String(html || "").match(
    /<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const resolve = (ref) =>
    typeof ref === "number" && ref >= 0 && ref < data.length ? data[ref] : ref;

  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [k, v] of Object.entries(item)) {
      if (!String(k).includes("/applicant/recruit/sub-list")) continue;
      const arr = resolve(v);
      if (!Array.isArray(arr) || !arr.length) continue;
      const out = [];
      for (const ref of arr) {
        const obj = resolve(ref);
        if (!obj || typeof obj !== "object") continue;
        out.push({
          recruitIdx: resolve(obj.recruitIdx),
          recruitTitle: resolve(obj.recruitTitle),
          recruitTypeCode: resolve(obj.recruitTypeCode),
          registerTime: resolve(obj.registerTime),
          publishStartTime: resolve(obj.publishStartTime),
          applyStartTime: resolve(obj.applyStartTime),
          applyEndTime: resolve(obj.applyEndTime),
          applyEarlyEndTime: resolve(obj.applyEarlyEndTime),
          applyMethodCode: resolve(obj.applyMethodCode),
          regionData: resolve(obj.regionData),
          organName: resolve(obj.organName),
          organTypeCode: resolve(obj.organTypeCode),
          organCode: resolve(obj.organCode),
        });
      }
      if (out.length) return out;
    }
  }
  return [];
}

function assertItems(data, label) {
  if (!Array.isArray(data) || !data.length) throw new Error(`${label}_empty`);
  if (!data[0]?.recruitIdx || !data[0]?.recruitTitle) throw new Error(`${label}_shape`);
  return data;
}

async function waitForClearance(page) {
  const deadline = Date.now() + 45000;
  let last = { title: "", hasNuxt: false };
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      title: document.title || "",
      hasNuxt: Boolean(document.getElementById("__NUXT_DATA__")),
    }));
    const blocked = /just a moment|attention required|moment please/i.test(last.title);
    if (last.hasNuxt && !blocked) return last;
    await page.waitForTimeout(1500);
  }
  throw new Error(`playwright_cf_timeout title=${last.title} nuxt=${last.hasNuxt}`);
}

async function scrapeWith(browserType, name) {
  const browser = await browserType.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage({
      userAgent: UA,
      locale: "ko-KR",
      extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" },
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(LIST, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForClearance(page);

    let items = null;
    try {
      const result = await page.evaluate(async (apiPath) => {
        const res = await fetch(apiPath, {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text: text.slice(0, 2000000) };
      }, API);
      if (
        result.ok &&
        !/just a moment|cloudflare|cf-browser-verification/i.test(result.text)
      ) {
        items = assertItems(JSON.parse(result.text), `${name}_api`);
      } else {
        console.warn(`${name}: api blocked status=${result.status}`);
      }
    } catch (e) {
      console.warn(`${name}: api evaluate failed`, e?.message || e);
    }

    if (!items) {
      const html = await page.content();
      items = assertItems(parseNuxtItems(html), `${name}_nuxt`);
    }

    fs.writeFileSync(OUT, JSON.stringify(items), "utf8");
    console.log(`playwright ${name} wrote ${items.length} → ${OUT}`);
  } finally {
    await browser.close();
  }
}

const engines = [
  [chromium, "chromium"],
  [firefox, "firefox"],
];
let lastErr;
for (const [type, name] of engines) {
  try {
    await scrapeWith(type, name);
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.warn(`playwright ${name} failed:`, e?.message || e);
  }
}
throw lastErr || new Error("playwright_failed");
