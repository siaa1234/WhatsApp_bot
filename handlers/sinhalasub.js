/* ================= 3. Gateway link → direct download URL =================
 * Gateway එක 3-step verification flow: Step1 → wait → Step2 → wait → Step3 unlock.
 * Puppeteer වලින් steps click කරලා final direct URL එක capture කරනවා.
 * Fallback: sinhalasub.lk npm getDownload() (static HTML path).
 */
const puppeteer = require('puppeteer');
const { getDownload } = require('sinhalasub.lk');

const DIRECT_HOST_RE = /pixeldrain|files-payout|filepayout|ddl\.sinhalasub|sinhalasub\.net|dlserver|telegram|\.(mp4|mkv|zip|rar)(\?|$)/i;

function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function resolveDirectViaBrowser(gatewayUrl) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(headers['User-Agent']);

    let captured = null;
    // download request / redirect capture
    page.on('request', (req) => {
      const u = req.url();
      if (!captured && DIRECT_HOST_RE.test(u)) captured = u;
    });
    page.on('response', (res) => {
      const u = res.url();
      if (!captured && DIRECT_HOST_RE.test(u) && res.status() < 400) captured = u;
    });
    browser.on('targetcreated', async (t) => {
      const u = t.url();
      if (!captured && DIRECT_HOST_RE.test(u)) captured = u;
    });

    await page.goto(gatewayUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // 3-step buttons sequentially unlock කරනවා — step text තියෙන buttons click
    for (let step = 1; step <= 3; step++) {
      if (captured) break;
      try {
        // step button හොයනවා: "Step N" text අද්දර තියෙන clickable element
        const clicked = await page.evaluate((n) => {
          const els = [...document.querySelectorAll('a, button, div, span, [role="button"]')];
          const target = els.find(e => new RegExp(`step\\s*${n}`, 'i').test(e.textContent || '')
            && !new RegExp(`step\\s*${n + 1}`, 'i').test(e.textContent || ''));
          if (target) { target.click(); return true; }
          return false;
        }, step);
        // target window open 5-8s තියන්න කියලා තියෙනවා
        await new Promise(r => setTimeout(r, 8000));
        if (!clicked) {
          // generic download/continue button try
          await page.evaluate(() => {
            const el = [...document.querySelectorAll('a, button')]
              .find(e => /download|continue|unlock|proceed/i.test(e.textContent || ''));
            if (el) el.click();
          });
          await new Promise(r => setTimeout(r, 4000));
        }
      } catch (_) {}
    }

    // final page එකේ <a> download link එකක් තියෙනවද බලනවා
    if (!captured) {
      try {
        const href = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a[href]')]
            .find(e => DIRECT_HOST_RE_source.test(e.href));
          return a ? a.href : null;
        });
        if (href) captured = href;
      } catch (_) {}
    }
    if (!captured && DIRECT_HOST_RE.test(page.url())) captured = page.url();
    if (!captured) throw new Error('3-step flow එකෙන් direct link හම්බුනේ නෑ');
    return { directUrl: captured, size: null };
  } finally {
    await browser.close().catch(() => {});
  }
}

// page.evaluate() ඇතුළේ use කරන්න regex source එක string විදිහට inject කරනවා
const DIRECT_HOST_RE_source = DIRECT_HOST_RE.source;

async function resolveDirect(gatewayUrl) {
  // 1) npm package (fast path — සමහර links static)
  try {
    const res = await getDownload(gatewayUrl);
    const directUrl = res?.result || res?.link || (typeof res === 'string' ? res : null);
    if (directUrl && /^https?:\/\//.test(directUrl)) {
      return { directUrl, size: null };
    }
  } catch (_) { /* fallback එකට යනවා */ }

  // 2) Puppeteer 3-step flow
  return resolveDirectViaBrowser(gatewayUrl);
}
