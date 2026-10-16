const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.CSZ_BASE || 'https://cinesubz.net';
const ASITHA_KEY = process.env.ASITHA_KEY || ''; // optional fallback API
const ASITHA_BASE = 'https://back.asitha.top/api';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
  Referer: BASE + '/',
};

const cszCache = new Map();
const cacheSet = (k, v, ttl = 30 * 60 * 1000) => {
  cszCache.set(k, { v, time: Date.now() });
  setTimeout(() => cszCache.delete(k), ttl).unref?.();
};

/* ---------- 1. Search ---------- */
async function search(query) {
  const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(query)}`, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const results = [], seen = new Set();
  $('a[href*="cinesubz"]').each((_, el) => {
    const $a = $(el), href = $a.attr('href') || '';
    const title = ($a.find('h2, h3').first().text() || $a.attr('title') || '').trim();
    if (!title || title.length < 8 || seen.has(href)) return;
    if (/\/(search|genre|release|keyword|account|category|tags?|wp-|page|contact|privacy|terms)/i.test(href)) return;
    if (/\/(movies|tvshows)\/?$/i.test(href)) return;
    if (/#|javascript:/i.test(href)) return;
    seen.add(href);
    const img = $a.find('img').first();
    results.push({ title, url: href, thumb: img.attr('src') || img.attr('data-src') || null });
  });
  return results.slice(0, 20);
}

/* ---------- 2. Quality links extract (1080p / 720p / 480p) ---------- */
async function getQualityLinks(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const links = [], seen = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').trim();
    const combined = `${text} ${href}`;

    const isVideo = /(1080p|720p|480p|\.mp4($|\?)|\.mkv($|\?)|\.zip($|\?)|\/dl\/|download)/i.test(combined);
    const isNoise = /(subtitle|\.srt($|\?)|trailer|youtube|facebook|telegram\.|t\.me|instagram|imdb|genre|release|keyword)/i.test(combined);
    if (isVideo && !isNoise && !seen.has(href)) {
      seen.add(href);
      const q = combined.match(/(1080p|720p|480p)/i)?.[1] || 'unknown';
      links.push({ quality: q.toLowerCase(), text: text || `Download ${q}`, url: href });
    }
  });

  const order = { '1080p': 0, '720p': 1, '480p': 2 };
  return links.sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).slice(0, 15);
}

/* ---------- 3. Direct link resolve ---------- */
// Redirect page එකක් නම් ඇතුළේ direct link එක extract කරනවා
// Direct file link එකක් නම් final URL එක ගන්නවා
async function resolveDirect(url, depth = 0) {
  if (depth > 4) return url; // වැඩිපුර redirect නම් මේ URL එකම return

  const res = await axios.get(url, {
    headers, timeout: 30000, maxRedirects: 10,
    responseType: 'stream',
  });

  const finalUrl = res.request?.res?.responseUrl || url;
  const contentType = res.headers['content-type'] || '';

  // HTML page එකක් නම් — ඇතුළේ direct link හොයනවා
  if (contentType.includes('text/html')) {
    const chunks = [];
    let html = '';
    res.data.on('data', (c) => chunks.push(c));
    await new Promise((r) => res.data.on('end', r));
    html = Buffer.concat(chunks).toString('utf8');
    res.destroy();

    const $ = cheerio.load(html);
    const candidates = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/(1080p|720p|480p|\.mp4($|\?)|\.mkv($|\?)|\.zip($|\?)|wp-content.*uploads)/i.test(href)) {
        candidates.push(href.startsWith('http') ? href : new URL(href, finalUrl).href);
      }
    });

    // JS එකෙන් set වෙන links වලට — script ඇතුළේ URLs හොයනවා
    if (!candidates.length) {
      const scriptMatch = html.match(/https?:\/\/[^"'\s<>]+\.(?:mp4|mkv|zip)[^"'\s<>]*/i);
      if (scriptMatch) candidates.push(scriptMatch[0]);
    }

    if (candidates.length) return resolveDirect(candidates[0], depth + 1);
    return finalUrl;
  }

  // Direct file එකක් නම් — header check විතරක් කරලා close කරනවා
  const cd = res.headers['content-disposition'] || '';
  const name = cd.match(/filename="?([^";]+)"?/i)?.[1]
    || decodeURIComponent(finalUrl.split('/').pop().split('?')[0])
    || 'movie.mp4';
  const size = Number(res.headers['content-length']) || 0;
  res.destroy();
  return { directUrl: finalUrl, name, size };
}

/* ---------- 3b. Fallback: ASITHA API (optional) ---------- */
async function asithaDirectUrl(movieUrl) {
  if (!ASITHA_KEY) return null;
  const { data } = await axios.get(`${ASITHA_BASE}/cinesubz/downloadurl`, {
    params: { apiKey: ASITHA_KEY, url: movieUrl },
    timeout: 30000,
  });
  // response format: { direct_url: "..." } / { url: "..." } — දෙකම cover කරනවා
  return data?.direct_url || data?.url || data?.link || null;
}

/* ---------- 4. Download + Upload (optional "⬆️ Upload" flow) ---------- */
async function downloadFile(url, filePath, onProgress) {
  const res = await axios.get(url, { headers, responseType: 'stream', timeout: 0 });
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

async function uploadToTelegram(ctx, filePath, name, caption) {
  const stream = fs.createReadStream(filePath);
  await ctx.replyWithVideo(
    { source: stream, filename: name },
    { caption, supports_streaming: true, parse_mode: 'HTML' }
  );
}

/* ---------- Commands ---------- */
async function cmdCinesubz(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/cinesubz\s*/i, '').trim();
  if (!query) return ctx.reply('🎬 Usage: /cinesubz <movie name>\nඋදා: /cinesubz vikram');
  const wait = await ctx.reply('🔎 CineSubz search...');
  try {
    const results = await search(query);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    if (!results.length) return ctx.reply(`❌ "${query}" වලට results නෑ.`);
    cacheSet(`r_${ctx.chat.id}`, results);
    const buttons = results.slice(0, 10).map((r, i) => [{ text: r.title.slice(0, 60), callback_data: `csz_${i}` }]);
    await ctx.reply(`🎬 <b>${query}</b> — results:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error('csz search:', e.message);
    ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    ctx.reply('⚠️ CineSubz connect වෙන්න බැරි වුණා.');
  }
}

async function handleCszCallback(ctx) {
  const parts = ctx.callbackQuery.data.split('_'); // csz_<i> / cszq_<quality>_<i> / cszu_<quality>_<i>
  const action = parts[1];   // '' / 'q' / 'u'
  const idx = parts[parts.length - 1];

  const cached = cszCache.get(`r_${ctx.chat.id}`);
  const post = cached?.v?.[parseInt(idx, 10)];
  if (!post) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /cinesubz.'); }

  /* Step 1: film select → quality buttons */
  if (!action) {
    await ctx.answerCbQuery('⏳ Links බලනවා...');
    try {
      const links = await getQualityLinks(post.url);
      if (!links.length) return ctx.reply('❌ Download links හම්බුනේ නෑ.\n' + post.url);
      cacheSet(`l_${ctx.chat.id}`, { post, links });
      const kb = links.map(l => [{ text: `🎬 ${l.quality.toUpperCase()} 🔗 Direct Link`, callback_data: `cszq_${l.quality}_${idx}` }]);
      await ctx.editMessageText(`<b>${post.title}</b>\n\nQuality එකක් තෝරන්න:`, {
        parse_mode: 'HTML', reply_markup: { inline_keyboard: kb },
      });
    } catch (e) { console.error('csz links:', e.message); ctx.reply('⚠️ Details error.'); }
    return;
  }

  /* Step 2a: quality select → resolve → direct link send */
  if (action === 'q') {
    const quality = parts[2];
    const cached2 = cszCache.get(`l_${ctx.chat.id}`);
    const link = cached2?.v?.links.find(l => l.quality === quality);
    if (!link) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired.'); }

    await ctx.answerCbQuery('🔗 Direct link resolve කරනවා...');
    const prog = await ctx.reply(`🔗 <b>${quality.toUpperCase()}</b> direct link resolve කරනවා...`, { parse_mode: 'HTML' });
    try {
      const result = await resolveDirect(link.url);
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});

      // result direct object එකක් නම් final URL එක ලැබුණා
      const directUrl = typeof result === 'string' ? result : result.directUrl;
      const name = typeof result === 'string' ? null : result.name;
      const size = typeof result === 'string' ? 0 : result.size;
      const sizeStr = size ? `\n📦 Size: <b>${(size / (1024 * 1024)).toFixed(0)} MB</b>` : '';

      await ctx.reply(
        `🎬 <b>${post.title}</b>\n🎥 Quality: <b>${quality.toUpperCase()}</b>${sizeStr}\n\n` +
        `🔗 <a href="${directUrl}">Direct Download Link</a>\n\n` +
        `💡 Link expired නම් නැවත resolve කරන්න.`,
        { parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: '⬆️ Telegram එකට Upload කරන්න', callback_data: `cszu_${quality}_${idx}` }]] } }
      );
    } catch (e) {
      console.error('csz resolve:', e.message);
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
      // Fallback: ASITHA API
      try {
        const fallback = await asithaDirectUrl(post.url);
        if (fallback) return ctx.reply(`🔗 Fallback Direct Link:\n\n<a href="${fallback}">Direct Download</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (_) {}
      ctx.reply(`⚠️ Direct link resolve වෙන්න බැරි වුණා.\n💡 Manual: ${link.url}`);
    }
    return;
  }

  /* Step 2b: "⬆️ Upload" button → download + Telegram upload */
  if (action === 'u') {
    const quality = parts[2];
    const cached2 = cszCache.get(`l_${ctx.chat.id}`);
    const link = cached2?.v?.links.find(l => l.quality === quality);
    if (!link) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired.'); }
    await ctx.answerCbQuery();

    const prog = await ctx.reply(`⬇️ <b>${quality.toUpperCase()}</b> download කරනවා... 0%`, { parse_mode: 'HTML' });
    const tmp = path.join(os.tmpdir(), `csz_${Date.now()}_${quality}.mp4`);
    try {
      const result = await resolveDirect(link.url);
      const directUrl = typeof result === 'string' ? result : result.directUrl;
      const name = typeof result === 'string' ? `movie_${quality}.mp4` : result.name;

      await downloadFile(directUrl, tmp, (pct) => {
        ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
          `⬇️ Download: ${pct}%\n🎬 ${post.title}`, { parse_mode: 'HTML' }).catch(() => {});
      });

      ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        '⬆️ Telegram එකට upload කරනවා...', { parse_mode: 'HTML' }).catch(() => {});
      await uploadToTelegram(ctx, tmp, name,
        `🎬 <b>${post.title}</b>\n🎥 Quality: <b>${quality.toUpperCase()}</b>`);
      fs.unlink(tmp, () => {});
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
    } catch (e) {
      console.error('csz upload:', e.message);
      fs.unlink(tmp, () => {});
      ctx.reply(`⚠️ Upload fail: ${e.message}\n\n💡 ලොකු files (50MB+) වලට LOCAL BOT API SERVER එකක් ඕනෑ.`);
    }
  }
}

module.exports = { cmdCinesubz, handleCszCallback, search, getQualityLinks, resolveDirect };
