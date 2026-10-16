const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cinesubz.co';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
};

async function search(query) {
  const { data } = await axios.get(`${BASE}/`, {
    params: { s: query, post_type: 'post' },
    headers,
    timeout: 20000,
  });
  return parseResults(data);
}

function parseResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('article').each((_, el) => {
    const a = $(el).find('h2 a, .entry-title a').first();
    const img = $(el).find('img').first();
    if (a.attr('href')) {
      results.push({
        title: a.text().trim(),
        url: a.attr('href'),
        thumb: img.attr('src') || img.attr('data-src') || null,
      });
    }
  });
  return results;
}

async function getDetails(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  // subtitle download links (site structure එකට අනුව adjust කරන්න)
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/\.srt($|\?)|\.zip($|\?)|download/i.test(href) && href.includes(BASE.replace('https://', ''))) {
      const text = $(el).text().trim();
      if (text && !links.find(l => l.url === href)) links.push({ text, url: href });
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
    if (!results.length) {
      await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id);
      return ctx.reply(`❌ "${query}" වලට results හම්බුනේ නෑ.`);
    }
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id);
    const buttons = results.slice(0, 10).map((r, i) => [
      { text: r.title.slice(0, 60), callback_data: `csz_${i}` },
    ]);
    ctx.session = ctx.session || {};
    ctx.session.cszResults = results;
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
  const results = ctx.session?.cszResults || [];
  const post = results[i];
  if (!post) return ctx.answerCbQuery('Expired. නැවත /cinesubz කරන්න.');
  await ctx.answerCbQuery('⏳ බලනවා...');
  try {
    const links = await getDetails(post.url);
    if (!links.length) return ctx.reply('❌ Subtitle links හම්බුනේ නෑ.\n' + post.url);
    const text = `<b>${post.title}</b>\n\n` +
      links.map(l => `📄 <a href="${l.url}">${l.text || 'Download'}</a>`).join('\n');
    ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: false });
  } catch (e) {
    console.error('cinesubz detail error:', e.message);
    ctx.reply('⚠️ Details ගන්න බැරි වුනා.');
  }
}

module.exports = { cmdCinesubz, handleCszCallback };
