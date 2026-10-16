const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://back.asitha.top/api';
const API_KEY = process.env.CSZ_API_KEY || process.env.CSZ_API_KEY;

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
};

// ✅ Module-level cache (chat_id -> { results, time }) — session middleware ඕනි නෑ
const cszCache = new Map();

function cacheSet(chatId, results, ttl = 30 * 60 * 1000) {
  cszCache.set(chatId, { results, time: Date.now() });
  setTimeout(() => {
    const c = cszCache.get(chatId);
    if (c && c.time <= Date.now() - ttl) cszCache.delete(chatId);
  }, ttl).unref?.();
}

async function search(query) {
  const { data } = await axios.get(
    `${BASE}/cinesubz/downloadurl`,
    { params: { apiKey: API_KEY, url: query }, headers, timeout: 20000 }
  );
  return parseResults(data);
}

function parseResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // Post card: card container එකේ h2/h3 title එක link එක ඇතුළේ තියෙනවා
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const title = $a.find('h2, h3').first().text().trim() || $a.attr('title')?.trim() || '';

    if (!title || title.length < 8) return;
    if (seen.has(href)) return;
    if (seen.has(title)) return;
    // Post URL pattern filter: /search|genre|release|keyword|account|wp-|category|# වගේ ඒවා skip
    if (/\/(search|genre|release|keyword|account|category|tags?|wp-|page)\//i.test(href)) return;
    if (/#|javascript:/i.test(href)) return;
    // Movie post URL විතරක්: single path segment හෝ movie slug
    if (!/\/[^/]+\/?$/.test(href)) return;
    if (/\/(movies|tvshows|contact-us|privacy-policy|terms-of-service)\/?$/i.test(href)) return;

    const img = $a.find('img').first();
    seen.add(href);
    results.push({
      title,
      url: href,
      thumb: img.attr('src') || img.attr('data-src') || null,
    });
  });

  return results.slice(0, 20);
}

async function getDetails(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const links = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (/\.zip($|\?)|\.rar($|\?)|\.srt($|\?)|download-sub|sub[-_]download|\/download\//i.test(href)) {
      if (!seen.has(href)) {
        seen.add(href);
        links.push({ text: text || 'Download', url: href });
      }
    }
  });
  return links.slice(0, 20);
}

async function cmdCsz(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/cinesubz\s*/i, '').trim();
  if (!query) {
    return ctx.reply('🎬 Usage: /cinesubz <movie name>\nඋදා: /cinesubz vikram');
  }
  const wait = await ctx.reply('🔎 CineSubz එකේ search කරනවා...');
  try {
    const results = await search(query);
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});

    if (!results.length) {
      return ctx.reply(`❌ "${query}" වලට results හම්බුනේ නෑ.`);
    }

    cacheSet(ctx.chat.id, results);

    const buttons = results.slice(0, 10).map((r, i) => [
      { text: r.title.slice(0, 60), callback_data: `csz_${i}` },
    ]);
    await ctx.reply(`🎬 <b>${query}</b> - results:`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (e) {
    console.error('cinesubz error:', e.message);
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
    ctx.reply('⚠️ CineSubz එකට connect වෙන්න බැරි වුනා. නැවත try කරන්න.');
  }
}

module.exports = { cmdCsz };
