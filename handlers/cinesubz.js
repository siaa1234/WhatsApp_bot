const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cinesubz.co';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
};

// ✅ Module-level cache (chat_id -> { results, time }) — session ඕනි නෑ
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
    `${BASE}/search/${encodeURIComponent(query)}`,
    { headers, timeout: 20000, maxRedirects: 5 }
  );
  return parseResults(data);
}

function parseResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // CineSubz theme: card container එකේ title link එක h2/h3 ඇතුළේ තියෙනවා.
  // Nav/footer links filter කරනවා — posts විතරක් ගන්නවා.
  $('a[href*="cinesubz"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const title = ($a.find('h2, h3').first().text() || '').trim()
      || $a.attr('title')?.trim()
      || '';

    if (!title || title.length < 8) return;
    if (seen.has(href)) return;

    // Post URL pattern filter: /search|genre|release|keyword|account|wp-|category|# වගේ ඒවා නම් skip
    if (/\/(search|genre|release|keyword|account|category|tags?|wp-|page)\//i.test(href)) return;
    if (/#|javascript:/i.test(href)) return;
    // Movie post URL විතරක්: domain root එකෙන් පස්සේ single path segment හෝ movie slug
    if (!/^https?:\/\/[^/]+\/[^/]+\/?$/.test(href.replace(/\/$/, '') + '/')) {
      // deep path නම්ත් post එකක් වෙන්න පුළුවන් — root-level nav නම් skip කරන්න
      if (/\/(movies|tvshows|contact-us|privacy-policy|terms-of-service)\/?$/i.test(href)) return;
    }

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

async function cmdCinesubz(ctx) {
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

async function handleCszCallback(ctx) {
  const i = parseInt(ctx.callbackQuery.data.replace('csz_', ''), 10);
  const cached = cszCache.get(ctx.chat?.id || ctx.from?.id);
  const post = cached?.results?.[i];

  if (!post) {
    await ctx.answerCbQuery();
    return ctx.reply('⌛ Request එක expired. නැවත /cinesubz search කරන්න.');
  }
  await ctx.answerCbQuery('⏳ බලනවා...');
  try {
    const links = await getDetails(post.url);
    if (!links.length) {
      return ctx.reply('❌ Subtitle links හම්බුනේ නෑ.\n' + post.url);
    }
    const text = `<b>${post.title}</b>\n\n` +
      links.map(l => `📄 <a href="${l.url}">${l.text || 'Download'}</a>`).join('\n');
    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: false });
  } catch (e) {
    console.error('cinesubz detail error:', e.message);
    ctx.reply('⚠️ Details ගන්න බැරි වුනා.');
  }
}

module.exports = { cmdCinesubz, handleCszCallback };
