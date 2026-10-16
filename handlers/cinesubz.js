const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.CSZ_BASE || 'https://cinesubz.net';
const ASITHA_KEY = process.env.ASITHA_KEY || '';
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

/* ---------- 2. Quality links — #directdownloadlinks table parsing ---------- */
async function getQualityLinks(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const links = [], seen = new Set();

  // Primary: #directdownloadlinks table rows
  // tr > td > a[href] (dl page) + a > strong (quality text) | td.eq(1) = size
  $('#directdownloadlinks > div > div > table > tbody > tr, #directdownloadlinks table tbody tr').each((_, el) => {
    const $tr = $(el);
    const href = $tr.find('td > a').attr('href') || '';
    const qText = $tr.find('td > a > strong').text().trim();
    const size = $tr.find('td').eq(1).text().trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    const q = qText.match(/(1080p|720p|480p)/i)?.[1] || qText;
    links.push({
      quality: String(q).toLowerCase().trim(),
      text: qText || 'Download',
      size: size || '',
      url: href.startsWith('http') ? href : new URL(href, postUrl).href,
    });
  });

  // Fallback 1: #directdownloadlinks ඇතුළේ plain links (table නැතුව) නම්
  if (!links.length) {
    $('#directdownloadlinks a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const qText = $(el).text().trim();
      if (!href || seen.has(href)) return;
      if (!/(720p|1080p|480p|\.zip($|\?)|\.mp4($|\?)|\.mkv($|\?)|\/dl)/i.test(`${qText} ${href}`)) return;
      seen.add(href);
      const q = `${qText} ${href}`.match(/(1080p|720p|480p)/i)?.[1] || 'unknown';
      links.push({ quality: q.toLowerCase(), text: qText || 'Download', size: '', url: href.startsWith('http') ? href : new URL(href, postUrl).href });
    });
  }

  // Fallback 2: /dl/ page links පිටත නම්
  if (!links.length) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!/\/dl\/|\?dl|download-sub/i.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);
      const qText = $(el).text().trim();
      const q = `${qText} ${href}`.match(/(1080p|720p|480p)/i)?.[1] || 'unknown';
      links.push({ quality: q.toLowerCase(), text: qText || 'Download', size: '', url: href.startsWith('http') ? href : new URL(href, postUrl).href });
    });
  }

  const order = { '1080p': 0, '720p': 1, '480p': 2 };
  return links.sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9)).slice(0, 15);
}

/* ---------- 3. DL page → direct link ---------- */
async function getDlPageDirect(dlUrl, depth = 0) {
  if (depth > 3) return dlUrl;
  const { data } = await axios.get(dlUrl, { headers, timeout: 20000, maxRedirects: 10 });
  const $ = cheerio.load(data);

  let candidates = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/(1080p|720p|480p|\.zip($|\?)|\.mp4($|\?)|\.mkv($|\?)|wp-content.*uploads)/i.test(href)) {
      candidates.push(href.startsWith('http') ? href : new URL(href, dlUrl).href);
    }
  });

  if (!candidates.length) {
    const m = data.match(/https?:\/\/[^"'\s<>]+\.(?:zip|mp4|mkv)[^"'\s<>]*/i);
    if (m) candidates.push(m[0]);
  }

  if (candidates.length) {
    const next = candidates[0];
    if (/\.(zip|mp4|mkv)($|\?)/i.test(next)) return next;
    try { return await getDlPageDirect(next, depth + 1); } catch (_) { return next; }
  }
  return dlUrl;
}

/* ---------- 3b. Direct file URL header check ---------- */
async function checkDirect(url) {
  const res = await axios.get(url, { headers, timeout: 30000, maxRedirects: 10, responseType: 'stream' });
  const finalUrl = res.request?.res?.responseUrl || url;
  const cd = res.headers['content-disposition'] || '';
  const name = cd.match(/filename="?([^";]+)"?/i)?.[1]
    || decodeURIComponent(finalUrl.split('/').pop().split('?')[0])
    || 'movie.mp4';
  const size = Number(res.headers['content-length']) || 0;
  res.destroy();
  return { directUrl: finalUrl, name, size };
}

/* ---------- 3c. Full resolve: dl page → direct file ---------- */
async function resolveDirect(linkUrl) {
  const direct = await getDlPageDirect(linkUrl);
  try {
    return await checkDirect(direct);
  } catch (_) {
    return { directUrl: direct, name: 'movie.mp4', size: 0 };
  }
}

/* ---------- 3d. Fallback: ASITHA API ---------- */
async function asithaDirectUrl(movieUrl) {
  if (!ASITHA_KEY) return null;
  const { data } = await axios.get(`${ASITHA_BASE}/cinesubz/downloadurl`, {
    params: { apiKey: ASITHA_KEY, url: movieUrl }, timeout: 30000,
  });
  return data?.direct_url || data?.url || data?.link || null;
}

/* ---------- 4. Download + Upload ---------- */
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
  await ctx.replyWithVideo(
    { source: fs.createReadStream(filePath), filename: name },
    { caption, supports_streaming: true, parse_mode: 'HTML' }
  );
}

/* ---------- Commands ---------- */
async function cmdCinesubz(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/cinesubz\s*/i, '').trim();
  if (!query) return ctx.reply('🎬 Usage: /cinesubz <movie name>\nඋදා: /cinesubz tarzan');
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
  const raw = ctx.callbackQuery.data; // 'csz_3' / 'cszq_720p_3' / 'cszu_1080p_3'

  // ✅ FIX: prefix එකෙන් action detect — underscore split bug එක අයින්
  let action = '', quality = null, idx = null;
  if (raw.startsWith('cszq_')) {
    [, quality, idx] = raw.split('_');
    action = 'q';
  } else if (raw.startsWith('cszu_')) {
    [, quality, idx] = raw.split('_');
    action = 'u';
  } else {
    idx = raw.replace(/^csz_/, '');
  }
  idx = parseInt(idx, 10);

  const cached = cszCache.get(`r_${ctx.chat.id}`);
  const post = cached?.v?.[idx];
  if (!post) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /cinesubz search කරන්න.'); }

  /* Step 1: film select → quality buttons */
  if (!action) {
    await ctx.answerCbQuery('⏳ Quality links බලනවා...');
    try {
      const links = await getQualityLinks(post.url);
      if (!links.length) return ctx.reply(`❌ Download links හම්බුනේ නෑ.\n${post.url}`);
      cacheSet(`l_${ctx.chat.id}`, { post, links });
      const kb = links.map(l => [{
        text: `🎬 ${l.text.slice(0, 40)}${l.size ? ` • ${l.size}` : ''}`,
        callback_data: `cszq_${l.quality}_${idx}`,
      }]);
      await ctx.editMessageText(`<b>${post.title}</b>\n\nQuality එකක් තෝරන්න:`, {
        parse_mode: 'HTML', reply_markup: { inline_keyboard: kb },
      });
    } catch (e) {
      console.error('csz links:', e.message);
      ctx.reply('⚠️ Details error.\n' + post.url);
    }
    return;
  }

  const cached2 = cszCache.get(`l_${ctx.chat.id}`);
  const link = cached2?.v?.links.find(l => l.quality === quality);
  if (!link) { await ctx.answerCbQuery(); return ctx.reply('⌛ Expired. නැවත /cinesubz search කරන්න.'); }

  /* Step 2a: quality → resolve → direct link send */
  if (action === 'q') {
    await ctx.answerCbQuery('🔗 Resolve කරනවා...');
    const prog = await ctx.reply(`🔗 <b>${quality.toUpperCase()}</b> direct link resolve කරනවා...`, { parse_mode: 'HTML' });
    try {
      const result = await resolveDirect(link.url);
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
      const sizeStr = result.size ? `\n📦 Size: <b>${(result.size / (1024 * 1024)).toFixed(0)} MB</b>` : (link.size ? `\n📦 Size: <b>${link.size}</b>` : '');
      await ctx.reply(
        `🎬 <b>${post.title}</b>\n🎥 <b>${link.text || quality.toUpperCase()}</b>${sizeStr}\n\n` +
        `🔗 <a href="${result.directUrl}">Direct Download Link</a>\n\n` +
        `💡 Link පැය කිපයකින් expire වෙනවා.`,
        { parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: '⬆️ Telegram එකට Upload කරන්න', callback_data: `cszu_${quality}_${idx}` }]] } }
      );
    } catch (e) {
      console.error('csz resolve:', e.message);
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
      try {
        const fb = await asithaDirectUrl(post.url);
        if (fb) return ctx.reply(`🔗 Fallback Direct Link:\n\n<a href="${fb}">Direct Download</a>`, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (_) {}
      ctx.reply(`⚠️ Resolve fail.\n💡 Manual page: ${link.url}`);
    }
    return;
  }

  /* Step 2b: Upload button → download → Telegram upload */
  if (action === 'u') {
    await ctx.answerCbQuery();
    const prog = await ctx.reply(`⬇️ <b>${quality.toUpperCase()}</b> download... 0%`, { parse_mode: 'HTML' });
    const tmp = path.join(os.tmpdir(), `csz_${Date.now()}_${quality}.mp4`);
    try {
      const result = await resolveDirect(link.url);
      await downloadFile(result.directUrl, tmp, (pct) => {
        ctx.telegram.editMessageText(prog.chat.id, prog.message_id,
          `⬇️ Download: ${pct}%\n🎬 ${post.title}`, { parse_mode: 'HTML' }).catch(() => {});
      });
      ctx.telegram.editMessageText(prog.chat.id, prog.message_id, '⬆️ Upload...', { parse_mode: 'HTML' }).catch(() => {});
      await uploadToTelegram(ctx, tmp, result.name,
        `🎬 <b>${post.title}</b>\n🎥 <b>${link.text || quality.toUpperCase()}</b>`);
      fs.unlink(tmp, () => {});
      ctx.telegram.deleteMessage(prog.chat.id, prog.message_id).catch(() => {});
    } catch (e) {
      console.error('csz upload:', e.message);
      fs.unlink(tmp, () => {});
      ctx.reply(`⚠️ Upload fail: ${e.message}\n\n💡 50MB+ files වලට LOCAL BOT API SERVER ඕනෑ.`);
    }
  }
}

module.exports = { cmdCinesubz, handleCszCallback, search, getQualityLinks, resolveDirect };
