const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cinesubz.co';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
};

// ✅ නිවැරදි මාර්ගය: /search/<query>
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

  // MviCard තේමා කාඩ්පත්: h2/h3 මාතෘකා සහ කාඩ්පත් කාඩ්පත් රූපය
  const cards = $(
    '.video-box, .card, article, .mvicard'
  ).toArray();

  cards.forEach((el) => {
    const $c = $(el);
    const a = $c.find('a[href]').first();
    const href = a.attr('href');
    let title = ($c.find('h2, h3').first().text() || a.text()).trim();
    if (!href || !title || title.length < 8) return;
    // නිත්‍ය නිවාරණ: බාගත නොකරන කාඩ්පත් නිත්‍ය විනිශ්චය
    if (/privacy|terms|contact|account|login|genre|release|keyword/i.test(title)) return;
    if (results.find(r => r.title === title)) return;

    const img = $c.find('img').first();
    results.push({
      title,
      url: href.startsWith('http') ? href : new URL(href, BASE).href,
      thumb: img.attr('src') || img.attr('data-src') || null,
    });
  });

  // කාඩ්පත් කාඩ්පත් අසාර්ථක වුණොත් fallback: කාඩ්පත් පොදු කාඩ්පත් රූප ලක්ෂණ
  if (!results.length) {
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const title = $a.find('h2, h3').first().text().trim() || $a.text().trim();
      if (title.length < 8) return;
      if (/privacy|terms|contact|account|login|genre|release|keyword|nav/i.test(href + title)) return;
      if (results.find(r => r.title === title)) return;
      const img = $a.find('img').first();
      results.push({
        title,
        url: href.startsWith('http') ? href : new URL(href, BASE).href,
        thumb: img.attr('src') || img.attr('data-src') || null,
      });
    });
  }

  return results.slice(0, 20);
}

async function getDetails(postUrl) {
  const { data } = await axios.get(postUrl, { headers, timeout: 20000 });
  const $ = cheerio.load(data);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (/\.zip($|\?)|\.rar($|\?)|\.srt($|\?)|download-sub|sub[-_]download|\/download\//i.test(href)) {
      if (!links.find(l => l.url === href)) {
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
