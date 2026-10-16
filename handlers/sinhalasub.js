// handlers/sinhalasub.js — sinhalasub.lk scraper → Telegram direct upload
// Quality: 720p / 1080p | Servers: Pixeldrain, DLServer-01/02, FilesPayout, Telagram
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');

const BASE = 'https://sinhalasub.lk';
const QUALITIES = ['HD 720p', 'FHD 1080p']; // priority order — 480p අවශ්‍ය නම් 'SD 480p' add කරන්න
const CB_PREFIX = 'ss_'; // callbacks: ss_<idx> / ssq_<quality>_<idx>

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
  Referer: BASE + '/',
};

const cache = new Map();
const cacheSet = (k, v, ttl = 30 * 60 * 1000) => {
  cache.set(k, { v, time: Date.now() });
  setTimeout(() => cache.delete(k), ttl).unref?.();
};

/* ================= 1. Search ================= */
async function search(query) {
  const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(query)}`, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const results = [], seen = new Set();

  $('a[href*="sinhalasub.lk"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = ($(el).find('h2, h3, .entry-title').first().text()
      || $(el).attr('title') || '').trim();
    const match = href.match(/https:\/\/sinhalasub\.lk\/(movies|tvshows)\/[^/]+\/?$/);
    if (!match || !title || title.length < 6 || seen.has(href)) return;
    seen.add(href);
    results.push({ title, url: href, type: match[1] === 'tvshows' ? 'tv' : 'movie' });
  });

  return results.slice(0, 10);
}

/* ================= 2. Movie page → quality links ================= */
async function getQualityLinks(url) {
  const { data } = await axios.get(url, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const out = [], seen = new Set();

  // structure: table rows — Options | Quality | Size → link → /links/<id>/
  $('a[href*="/links/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (seen.has(href)) return;
    const $a = $(el);
    // server name එක link text එකෙන් / closest table එකෙන්
    const server = ($a.closest('table').find('caption, th').first().text()
      || $a.text() || '').trim();
    const row = $a.closest('tr');
    let quality = row.find('td').eq(1).text().trim();
    let size = row.find('td').eq(2).text().trim();

    // fallback: row text එකෙන් quality/size guess
    if (!quality) {
      const t = row.text();
      if (/1080|FHD/i.test(t)) quality = 'FHD 1080p';
      else if (/720|HD(?!\s*1080)/i.test(t)) quality = 'HD 720p';
      else if (/480|SD/i.test(t)) quality = 'SD 480p';
      size = size || (t.match(/[\d.]+\s*(GB|MB)/i) || [])[0] || '';
    }
    if (!QUALITIES.includes(quality)) return;
    seen.add(href);
    out.push({ quality, size, server: server.replace(/^#?\s*$/, 'DLServer'), url: href });
  });

  // quality priority order එකට sort
  out.sort((a, b) => QUALITIES.indexOf(a.quality) - QUALITIES.indexOf(b.quality));
  return out;
}

/* ================= 3. /links/<id>/ → direct URL (Puppeteer unlock) =================
 * "Secure Download Portal" — 3-step JS unlock:
 *   Step 1: Initial Link Pass     (click → 5s)
 *   Step 2: Security Verification (click → 5s)
 *   Step 3: Final Download Unlock (click → direct link)
 * Static HTML එකේ final link නැහැ — headless browser එකෙන් simulate කරනවා.
 */
async function resolveDirect(linkUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(headers['User-Agent']);
    await page.setViewport({ width: 1280, height: 800 });

    // final link එක new tab/popup එකෙන් open වෙනවා ඇති — track කරන්න
    const targetUrlPromise = new Promise((resolve) => {
      browser.on('targetcreated', (target) => {
        try {
          if (target.type() === 'page') {
            const u = target.url();
            if (/pixeldrain|mega\.nz|\.mp4|\.mkv|files\.|payout|download/i.test(u)) resolve(u);
          }
        } catch {}
      });
    });

    await page.goto(linkUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    /* 3-step unlock — active button click → 5s wait → පස්සේ step unlock වෙනවා */
    let steps = 0;
    for (let i = 0; i < 3; i++) {
      const btnHandle = await page.$('button:not([disabled]), a.btn:not([disabled]), .btn:not([disabled]), input[type="submit"]:not([disabled])');
      if (!btnHandle) break;
      try {
        await btnHandle.click();
        steps++;
        console.log(`🔓 Step ${steps} unlocked, 5s wait...`);
        await new Promise(r => setTimeout(r, 5500)); // "keep target window open 5s"
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
      } catch (e) {
        console.log('ℹ️ step click fail:', e.message);
        break;
      }
    }

    /* Final link හොයනවා — (a) new tab (b) DOM (c) raw HTML regex */
    let direct = null;

    // (a) new tab/popup target එකෙන්
    const raceTimeout = new Promise(r => setTimeout(() => r(null), 20000));
    const targetUrl = await Promise.race([targetUrlPromise, raceTimeout]);
    if (targetUrl) direct = targetUrl;

    // (b) click කරාට පස්සේ DOM එකේ generate වෙච්ච links
    if (!direct) {
      await new Promise(r => setTimeout(r, 3000));
      direct = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.href || '';
          if (/pixeldrain\.com\/(u|api)\/[a-z0-9]+/i.test(h)) out.push(h);
          else if (/\.(mp4|mkv|avi|mov)(\?|$)/i.test(h)) out.push(h);
          else if (/mega\.nz\/file|pixeldra\.in/i.test(h)) out.push(h);
        });
        document.querySelectorAll('[data-href],[data-link],[data-url]').forEach(el => {
          const v = el.getAttribute('data-href') || el.getAttribute('data-link') || el.getAttribute('data-url') || '';
          if (/pixeldrain|\.mp4|\.mkv/i.test(v)) out.push(v);
        });
        return out[0] || null;
      });
    }

    // (c) raw page HTML regex fallback
    if (!direct) {
      const html = await page.content();
      const m = html.match(/https?:\/\/[^'"\\\s]*(?:pixeldrain\.com\/(?:u|api)\/[a-z0-9]+[^'"\\\s]*|mega\.nz\/file\/[^'"\\\s]*|\.(?:mp4|mkv|avi)(?:\?[^'"\\\s]*)?)/i);
      if (m) direct = m[0];
    }

    if (!direct) {
      throw new Error(`Direct link හම්බුනේ නෑ (${steps} steps unlock, final link හම්බුනේ නෑ). URL: ${linkUrl}`);
    }

    /* Pixeldrain → API direct download URL */
    let filename = `ss_${Date.now()}.mp4`, size = 0;
    if (/pixeldrain\.com\/u\/([a-z0-9]+)/i.test(direct)) {
      const id = direct.match(/pixeldrain\.com\/u\/([a-z0-9]+)/i)[1];
      direct = `https://pixeldrain.com/api/file/${id}?download`;
    }
    // content-disposition එකෙන් filename + content-length එකෙන් size
    try {
      const head = await axios.head(direct, {
        headers: { ...headers, Referer: BASE + '/' }, timeout: 20000, maxRedirects: 5,
      });
      const cd = head.headers['content-disposition'] || '';
      const fm = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      size = Number(head.headers['content-length']) || 0;
      if (fm) filename = decodeURIComponent(fm[1]);
    } catch {}
    return { directUrl: direct, filename, size };
  } finally {
    await browser.close();
  }
}

/* ================= 4. Download (stream + progress) ================= */
async function downloadFile(url, filePath, onProgress) {
  const res = await axios.get(url, {
    headers: { ...headers, Referer: BASE + '/' },
    responseType: 'stream', timeout: 0, maxRedirects: 10,
  });
  const total = Number(res.headers['content-length']) || 0;
  let done = 0, lastPct = -10;

  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    res.data.on('data', (chunk) => {
      done += chunk.length;
      if (total && onProgress) {
        const pct = Math.floor((done / total) * 100);
        if (pct >= lastPct + 10) { lastPct = pct; onProgress(pct); }
      }
    });
    res.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    res.data.on('error', reject);
  });
}

/* ================= 5. Convert → proper MP4 (faststart remux) ================= */
async function convertToMp4(inPath) {
  const outPath = inPath.replace(/\.[^.]+$/, '') + '_conv.mp4';
  if (/\.mp4$/i.test(inPath)) {
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c', 'copy', '-movflags', '+faststart', outPath], (e) => e ? rej(e) : res()));
    return { outPath, reencoded: false };
  }
  // mkv/avi → mp4 (codec-compatible නම් copy, නැත්නම් re-encode)
  try {
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath],
      (e) => e ? rej(e) : res()));
    return { outPath, reencoded: false };
  } catch {
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac',
      '-movflags', '+faststart', outPath], (e) => e ? rej(e) : res()));
    return { outPath, reencoded: true };
  }
}

/* ================= 6. Upload (Telegram video, streaming) ================= */
async function uploadMp4(ctx, mp4Path, caption) {
  await ctx.replyWithVideo(
    { source: fs.createReadStream(mp4Path) },
    { caption, supports_streaming: true, parse_mode: 'HTML' }
  );
}

/* ================= Commands ================= */
async function cmdSinhalasub(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/ss\s*/i, '').trim();
  if (!query) return ctx.reply('🎬 Usage: /ss <movie name>\nඋදා: /ss shark bait');
  const wait = await ctx.reply('🔎 SinhalaSub search...');
  try {
    const results = await search(query);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    if (!results.length) return ctx.reply(`❌ "${query}" වලට results නෑ.`);
    cacheSet(`ss_r_${ctx.chat.id}`, results);
    const buttons = results.map((r, i) => [{ text: r.title.slice(0, 60), callback_data: `ss_${i}` }]);
    await ctx.reply(`🎬 <b>${query}</b> — results:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error('ss search:', e.message);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    ctx.reply('⚠️ SinhalaSub connect වෙන්න බැරි වුණා.');
  }
}

async function handleSsCallback(ctx) {
  const raw = ctx.callbackQuery?.data || '';
  let quality = null, idx;
  if (raw.startsWith('ssq_')) { [, quality, idx] = raw.split('_'); }
  else { idx = raw.replace(/^ss_/, ''); }
  idx = parseInt(idx, 10);
  if (isNaN(idx)) { await ctx.answerCbQuery(); return; }

  const cached = cache.get(`ss_r_${ctx.chat.id}`);
  const post = cached?.v?.[idx];
  if (!post) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /ss search කරන්න.'); }

  /* ---- Step 1: film select → 720p / 1080p buttons ---- */
  if (!quality) {
    await ctx.answerCbQuery('⏳ Links බලනවා...');
    try {
      const links = await getQualityLinks(post.url);
      if (!links.length) return ctx.reply(`❌ Download links හම්බුනේ නෑ.\n${post.url}`);
      cacheSet(`ss_l_${ctx.chat.id}`, { post, links });

      const kb = QUALITIES.map(q => {
        const l = links.find(x => x.quality === q);
        return [{ text: l ? `🎬 ${q}${l.size ? ' • ' + l.size : ''}` : `${q} ❌`,
                  callback_data: l ? `ssq_${q.split(' ')[1]}_${idx}` : 'ss_none' }];
      });
      await ctx.editMessageText(`<b>${post.title}</b>\n\nQuality select කරන්න:`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    } catch (e) {
      console.error('ss links:', e.message);
      ctx.reply('⚠️ Details error.\n' + post.url);
    }
    return;
  }

  /* ---- Step 2: quality select → resolve → download → convert → upload ---- */
  const cached2 = cache.get(`ss_l_${ctx.chat.id}`);
  const { links } = cached2?.v || {};
  // ssq_1080_3 → 'FHD 1080p' match, ssq_720p_3 → 'HD 720p' match
  const qKey = quality === '1080' || quality === '1080p' ? 'FHD 1080p' : 'HD 720p';
  const chosen = (links || []).filter(l => l.quality === qKey);
  if (!chosen.length) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /ss search කරන්න.'); }
  await ctx.answerCbQuery(`⏳ ${qKey} resolve...`);

  const prog = await ctx.reply(`⬇️ <b>${qKey}</b> resolve + download... 0%`, { parse_mode: 'HTML' });
  const tmp = path.join(os.tmpdir(), `ss_${Date.now()}.mp4`);
  try {
    // 1) resolve direct — servers කිහිපයක් තියෙනවා quality එකකට, first working එක use කරනවා
    let resolved = null, lastErr;
    for (const l of chosen) {
      try { resolved = await resolveDirect(l.url); break; } catch (e) { lastErr = e; }
    }
    if (!resolved) throw lastErr || new Error('resolve fail');
    console.log(`✅ Resolved: ${resolved.directUrl} (${resolved.size ? (resolved.size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'size unknown'})`);

    // 2) download
    await downloadFile(resolved.directUrl, tmp, (pct) => {
      ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        `⬇️ Download: ${pct}%\n🎬 ${post.title}`, { parse_mode: 'HTML' }).catch(() => {});
    });

    // 3) convert → proper mp4
    ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
      '🎬 MP4 එකට convert කරනවා... (mkv නම් ටිකක් යනවා)',
      { parse_mode: 'HTML' }).catch(() => {});
    const conv = await convertToMp4(tmp);
    console.log(`✅ Convert ${conv.reencoded ? '(re-encoded)' : '(remuxed)'}: ${conv.outPath}`);

    // 4) upload mp4 video (streaming)
    ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
      '⬆️ Telegram එකට upload... (ලොකු file නම් 10-30min)',
      { parse_mode: 'HTML' }).catch(() => {});
    await uploadMp4(ctx, conv.outPath,
      `🎬 <b>${post.title}</b>\n🎥 <b>${qKey}</b> • MP4\n🔗 ${post.url}`);

    // 5) cleanup
    fs.unlink(tmp, () => {});
    if (conv.outPath !== tmp) fs.unlink(conv.outPath, () => {});
    ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
  } catch (e) {
    console.error('ss flow:', e.message);
    fs.unlink(tmp, () => {});
    ctx.reply(`⚠️ Fail: ${e.message}\n\n💡 50MB+ uploads වලට LOCAL BOT API SERVER ඕනෑ.`);
  }
}

module.exports = { cmdSinhalasub, handleSsCallback, search, getQualityLinks, resolveDirect };
