const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.CSZ_BASE || 'https://cinesubz.net';
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
  Referer: BASE,
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
    if (/\/(search|genre|release|keyword|account|category|tags?|wp-|page|movies\/?|tvshows\/?|contact|privacy|terms)/i.test(href)) return;
    if (/#|javascript:/i.test(href)) return;
    seen.add(href);
    const img = $a.find('img').first();
    results.push({ title, url: href, thumb: img.attr('src') || img.attr('data-src') || null });
  });
  return results.slice(0, 20);
}

/* ---------- 2. Quality links extract (720p / 1080p) ---------- */
async function getQualityLinks(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const links = [], seen = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').trim();
    const combined = `${text} ${href}`;

    // quality markers හෝ file/download paths විතරක් ගන්නවා
    const isVideo = /(1080p|720p|480p|\.mp4($|\?)|\.mkv($|\?)|\.zip($|\?)|\/dl\/|download)/i.test(combined);
    const isNoise = /(subtitle|\.srt($|\?)|trailer|youtube|facebook|telegram|t\.me|instagram|imdb)/i.test(combined);
    if (isVideo && !isNoise && !seen.has(href)) {
      seen.add(href);
      const q = href.match(/(1080p|720p|480p)/i)?.[1]
        || text.match(/(1080p|720p|480p)/i)?.[1]
        || 'unknown';
      links.push({ quality: q.toLowerCase(), text: text || `Download ${q}`, url: href });
    }
  });

  // quality order: 1080p → 720p → 480p
  const order = { '1080p': 0, '720p': 1, '480p': 2 };
  return links.sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).slice(0, 15);
}

/* ---------- 3. Direct URL resolve (redirects follow කරනවා) ---------- */
async function resolveDirect(url) {
  const res = await axios.get(url, {
    headers, timeout: 30000, maxRedirects: 10,
    responseType: 'stream',
  });
  // final URL + filename headers එකෙන් ගන්නවා
  const finalUrl = res.request?.res?.responseUrl || url;
  const cd = res.headers['content-disposition'] || '';
  const name = cd.match(/filename="?([^";]+)"?/i)?.[1]
    || decodeURIComponent(finalUrl.split('/').pop().split('?')[0])
    || 'movie.mp4';
  const size = Number(res.headers['content-length']) || 0;
  res.destroy(); // header check විතරයි — full download පස්සේ කරනවා
  return { finalUrl, name, size };
}

/* ---------- 4. Download to disk (stream) ---------- */
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

/* ---------- 5. Upload to Telegram (video, streaming) ---------- */
async function uploadToTelegram(ctx, filePath, name, size, caption) {
  // ලොකු files වලට local Bot API server එකක් ඕනෑ
  const tg = process.env.BOT_API_SERVER ? ctx.telegram withEndpoint : ctx.telegram;
  // Telegraf: apiRoot set කරලා නම් automatic — index.js එකේ configure කරන්න (පහළ බලන්න)
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
  const [, action, idx] = ctx.callbackQuery.data.split('_'); // csz_<i> / cszq_<quality>_<i>
  const cached = cszCache.get(`r_${ctx.chat.id}`);
  const post = cached?.v?.[parseInt(idx, 10)];

  if (!post) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /cinesubz.'); }

  /* Step 1: movie page → quality links */
  if (!action || action === '') {
    await ctx.answerCbQuery('⏳ Links බලනවා...');
    try {
      const links = await getQualityLinks(post.url);
      if (!links.length) return ctx.reply('❌ Download links හම්බුනේ නෑ.\n' + post.url);
      cacheSet(`l_${ctx.chat.id}`, { post, links });
      const kb = links.map(l => [{ text: `🎬 ${l.quality.toUpperCase()}`, callback_data: `cszq_${l.quality}_${idx}` }]);
      await ctx.editMessageText(`<b>${post.title}</b>\n\nQuality එකක් තෝරන්න:`, {
        parse_mode: 'HTML', reply_markup: { inline_keyboard: kb },
      });
    } catch (e) { console.error(e.message); ctx.reply('⚠️ Details error.'); }
    return;
  }

  /* Step 2: quality → resolve → download → upload */
  if (action === 'q') {
    const quality = ctx.callbackQuery.data.split('_')[1];
    const cached2 = cszCache.get(`l_${ctx.chat.id}`);
    const link = cached2?.v?.links.find(l => l.quality === quality);
    if (!link) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired.'); }
    await ctx.answerCbQuery();
    const prog = await ctx.reply(`⬇️ <b>${quality.toUpperCase()}</b> download කරනවා... 0%`, { parse_mode: 'HTML' });
    const tmp = path.join(os.tmpdir(), `csz_${Date.now()}_${quality}.mp4`);
    try {
      const { finalUrl, name } = await resolveDirect(link.url);
      await downloadFile(finalUrl, tmp, (pct) => {
        ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
          `⬇️ Download: ${pct}%\n🎬 ${post.title}`, { parse_mode: 'HTML' }).catch(() => {});
      });
      await ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
        '⬆️ Telegram එකට upload කරනවා...', { parse_mode: 'HTML' }).catch(() => {});
      await uploadToTelegram(ctx, tmp, name, 0,
        `🎬 <b>${post.title}</b>\n🎥 Quality: <b>${quality.toUpperCase()}</b>\n🔗 Source: ${post.url}`);
      fs.unlink(tmp, () => {});
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
    } catch (e) {
      console.error('csz dl:', e.message);
      fs.unlink(tmp, () => {});
      ctx.reply(`⚠️ Download/Upload fail: ${e.message}\n\n💡 ලොකු files වලට LOCAL BOT API SERVER එකක් ඕනෑ (50MB limit නිසා).`);
    }
  }
}

module.exports = { cmdCinesubz, handleCszCallback, search, getQualityLinks };
