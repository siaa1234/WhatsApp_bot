// handlers/sinhalasub.js — sinhalasub.lk scraper → Telegram direct upload
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const BASE = 'https://sinhalasub.lk';
const QUALITIES = ['FHD 1080p', 'HD 720p']; // 480p අවශ්‍ය නම් 'SD 480p' add කරන්න

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

/* ---------- 1. Search ---------- */
async function search(query) {
  const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(query)}`, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const results = [], seen = new Set();
  $('a[href*="sinhalasub.lk"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = ($(el).find('h2, h3, .entry-title').first().text() || $(el).attr('title') || '').trim();
    const match = href.match(/https:\/\/sinhalasub\.lk\/(movies|tvshows)\/[^/]+\/?$/);
    if (!match || !title || title.length < 6 || seen.has(href)) return;
    seen.add(href);
    results.push({ title, url: href, type: match[1] === 'tvshows' ? 'tv' : 'movie' });
  });
  return results.slice(0, 10);
}

/* ---------- 2. Movie page → quality+server links ---------- */
async function getQualityLinks(url) {
  const { data } = await axios.get(url, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const out = [], seen = new Set();

  // structure: table rows Options | Quality | Size, link → /links/<id>/
  $('a[href*="/links/"]').each((_, el) => {
    const $a = $(el), href = $a.attr('href');
    if (seen.has(href)) return;
    // මේ link එක අයිති table row එකේ quality එක හොයනවා
    const row = $a.closest('tr');
    let quality = row.find('td').eq(1).text().trim();
    let size = row.find('td').eq(2).text().trim();
    // fallback: row text එකෙන්
    if (!quality) {
      const t = row.text();
      if (/1080|FHD/i.test(t)) quality = 'FHD 1080p';
      else if (/720|HD/i.test(t)) quality = 'HD 720p';
      else if (/480|SD/i.test(t)) quality = 'SD 480p';
      size = size || (t.match(/[\d.]+\s*(GB|MB)/i) || [])[0] || '';
    }
    if (!QUALITIES.includes(quality)) return;
    seen.add(href);
    out.push({ quality, size, url: href });
  });

  // 720p → 1080p order
  out.sort((a, b) => QUALITIES.indexOf(a.quality) - QUALITIES.indexOf(b.quality));
  return out;
}

/* ---------- 3. /links/<id>/ → direct URL ---------- */
async function resolveDirect(linkUrl) {
  const { data } = await axios.get(linkUrl, { headers, timeout: 30000, maxRedirects: 10 });
  const $ = cheerio.load(data);

  // (a) hidden / direct anchors — pixeldrain, mega, direct mp4/mkv
  const candidates = [];
  $('a[href]').each((_, el) => {
    const h = $(el).attr('href') || '';
    if (/pixeldrain\.com\/u\/[a-z0-9]+/i.test(h)) candidates.push(h);
    else if (/\.(mp4|mkv|avi|mov)(\?|$)/i.test(h)) candidates.push(h);
    else if (/pixeldrain\.com\/api\/file/i.test(h)) candidates.push(h);
  });
  // (b) data-* / onclick hidden attributes
  $('[data-href],[data-link],[data-url],[onclick]').each((_, el) => {
    const v = $(el).attr('data-href') || $(el).attr('data-link') || $(el).attr('data-url') || '';
    if (/pixeldrain|\.mp4|\.mkv/i.test(v)) candidates.push(v);
    const oc = $(el).attr('onclick') || '';
    const m = oc.match(/https?:\/\/[^'"\\\s]+/);
    if (m) candidates.push(m[0]);
  });

  let direct = candidates[0];

  // (c) Pixeldrain → API direct download URL
  if (direct && /pixeldrain\.com\/u\/([a-z0-9]+)/i.test(direct)) {
    const id = direct.match(/pixeldrain\.com\/u\/([a-z0-9]+)/i)[1];
    direct = `https://pixeldrain.com/api/file/${id}?download`;
  }
  if (!direct) throw new Error('Direct link හම්බුනේ නෑ (unlock page structure වෙනස් වෙලා ඇති). URL: ' + linkUrl);

  // (d) content-disposition එකෙන් filename
  let filename = `ss_${Date.now()}.mp4`;
  try {
    const head = await axios.head(direct, { headers: { ...headers, Referer: BASE + '/' }, timeout: 20000, maxRedirects: 5 });
    const cd = head.headers['content-disposition'] || '';
    const fm = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const size = Number(head.headers['content-length']) || 0;
    if (fm) filename = decodeURIComponent(fm[1]);
    return { directUrl: direct, filename, size };
  } catch {
    return { directUrl: direct, filename, size: 0 };
  }
}

/* ---------- 4. Download ---------- */
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

/* ---------- 5. Convert → proper MP4 (remux) ---------- */
async function convertToMp4(inPath) {
  const outPath = inPath.replace(/\.[^.]+$/, '') + '_conv.mp4';
  const isMp4 = /\.mp4$/i.test(inPath);
  if (isMp4) {
    // faststart remux — streaming-friendly
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c', 'copy', '-movflags', '+faststart', outPath], (e) => e ? rej(e) : res()));
    return { outPath, reencoded: false };
  }
  // mkv/avi → mp4 remux (codec compatible නම් copy)
  try {
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath],
      (e) => e ? rej(e) : res()));
    return { outPath, reencoded: false };
  } catch {
    // fallback: re-encode
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac',
      '-movflags', '+faststart', outPath], (e) => e ? rej(e) : res()));
    return { outPath, reencoded: true };
  }
}

/* ---------- 6. Upload ---------- */
async function uploadMp4(ctx, mp4Path, caption) {
  await ctx.replyWithVideo(
    { source: fs.createReadStream(mp4Path) },
    { caption, supports_streaming: true, parse_mode: 'HTML' }
  );
}

/* ---------- Commands ---------- */
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
    await ctx.reply(`🎬 <b>${query}</b> — results:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error('ss search:', e.message);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    ctx.reply('⚠️ SinhalaSub connect වෙන්න බැරි වුණා.');
  }
}

async function handleSsCallback(ctx) {
  const raw = ctx.callbackQuery.data; // 'ss_2' / 'ssq_1080_2'
  let quality = null, idx;
  if (raw.startsWith('ssq_')) { [, quality, idx] = raw.split('_'); } else { idx = raw.replace(/^ss_/, ''); }
  idx = parseInt(idx, 10);

  const cached = cache.get(`ss_r_${ctx.chat.id}`);
  const post = cached?.v?.[idx];
  if (!post) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /ss search කරන්න.'); }

  /* Step 1: film select → 720p / 1080p buttons */
  if (!quality) {
    await ctx.answerCbQuery('⏳ Links බලනවා...');
    try {
      const links = await getQualityLinks(post.url);
      if (!links.length) return ctx.reply(`❌ Download links හම්බුනේ නෑ.\n${post.url}`);
      cacheSet(`ss_l_${ctx.chat.id}`, { post, links });
      // quality එකකට servers කිහිපයක් තියෙනවා — quality select කරලා පස්සේ server pick
      const qBtns = QUALITIES.map(q => [{
        text: links.some(l => l.quality === q)
          ? `🎬 ${q}${links.find(l => l.quality === q).size ? ' • ' + links.find(l => l.quality === q).size : ''}`
          : q + ' ❌',
        callback_data: links.some(l => l.quality === q) ? `ssq_${q.split(' ')[1]}_${idx}` : 'ss_none',
      }]);
      await ctx.editMessageText(`<b>${post.title}</b>\n\nQuality select කරන්න:`, {
        parse_mode: 'HTML', reply_markup: { inline_keyboard: qBtns },
      });
    } catch (e) {
      console.error('ss links:', e.message);
      ctx.reply('⚠️ Details error.\n' + post.url);
    }
    return;
  }

  /* Step 2: quality select → server pick (DLServer-01 priority) */
  const cached2 = cache.get(`ss_l_${ctx.chat.id}`);
  const { links } = cached2?.v || {};
  const chosen = links.filter(l => l.quality.includes(quality));
  if (!chosen.length) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /ss search කරන්න.'); }
  await ctx.answerCbQuery();

  const prog = await ctx.reply(`⬇️ <b>${chosen[0].quality}</b> resolve + download... 0%`, { parse_mode: 'HTML' });
  const tmp = path.join(os.tmpdir(), `ss_${Date.now()}.mp4`);
  try {
    // 1) resolve direct (first working server)
    let resolved = null, lastErr;
    for (const l of chosen) {
      try { resolved = await resolveDirect(l.url); break; } catch (e) { lastErr = e; }
    }
    if (!resolved) throw lastErr || new Error('resolve fail');

    // 2) download
    await downloadFile(resolved.directUrl, tmp, (pct) => {
      ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        `⬇️ Download: ${pct}%\n🎬 ${post.title}`, { parse_mode: 'HTML' }).catch(() => {});
    });

    // 3) convert
    ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
      '🎬 MP4 එකට convert කරනවා...', { parse_mode: 'HTML' }).catch(() => {});
    const conv = await convertToMp4(tmp);

    // 4) upload
    ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
      '⬆️ Telegram එකට upload... (ලොකු file නම් 10-30min)', { parse_mode: 'HTML' }).catch(() => {});
    await uploadMp4(ctx, conv.outPath,
      `🎬 <b>${post.title}</b>\n🎥 <b>${chosen[0].quality}</b> • MP4\n🔗 ${post.url}`);

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
