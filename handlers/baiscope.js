// handlers/baiscope.js — බයිස්කෝප් සිංහලෙන් subtitle scraper
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'https://www.baiscope.lk';

// 403 bypass වලට browser headers
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,si;q=0.8',
  'Referer': BASE + '/'
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Search ----------
async function searchBaiscope(query) {
  const { data: html } = await axios.get(`${BASE}/?s=${encodeURIComponent(query)}`, {
    headers: HEADERS, timeout: 20000
  });
  const $ = cheerio.load(html);
  const results = [];

  // search results: title link → /movies/... හෝ /tv/...
  $('article, .post, .search-result').each((i, el) => {
    const a = $(el).find('a[href*="/movies/"], a[href*="/tv/"]').first();
    const title = $(el).find('h2, h3, .entry-title').first().text().trim()
      || a.attr('title') || '';
    if (a.length && title) {
      results.push({ title, url: a.attr('href') });
    }
  });

  // fallback: article structure නැත්නම් headings වලින් ගන්න
  if (!results.length) {
    $('h2 a, h3 a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('/movies/') || href.includes('/tv/')) {
        results.push({ title: $(el).text().trim(), url: href });
      }
    });
  }

  return results.slice(0, 10);
}

// ---------- Movie page → subtitle download link ----------
async function getSubtitleLink(pageUrl) {
  const { data: html } = await axios.get(pageUrl, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(html);

  // සාමාන්‍යයෙන් "Download Sinhala Subtitle" button/link එකක් තියෙනවා
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().toLowerCase();
    if (
      href.includes('dl.baiscope') ||
      href.includes('/download') ||
      href.match(/\.zip$|\.rar$|\.srt$/i) ||
      text.includes('download') && (text.includes('subtitle') || text.includes('සිංහල'))
    ) {
      links.push({ url: href, text: $(el).text().trim() });
    }
  });

  const poster = $('meta[property="og:image"]').attr('content') || '';
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content') || 'Unknown';

  return { title, poster, links: [...new Map(links.map(l => [l.url, l])).values()] };
}

// ---------- Download .srt/.zip file ----------
async function downloadSubtitle(url, referer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-'));
  const { data, headers } = await axios.get(url, {
    headers: { ...HEADERS, Referer: referer },
    responseType: 'arraybuffer',
    timeout: 30000,
    maxRedirects: 5
  });

  // filename එක Content-Disposition එකෙන් ගන්න
  const cd = headers['content-disposition'] || '';
  let filename = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]
    || url.split('/').pop().split('?')[0] || 'subtitle.srt';

  // redirect chain එකේ අන්තිම URL එකෙන් extension එක ගන්න
  const ext = path.extname(filename) || '.srt';
  const filePath = path.join(dir, `subtitle${ext}`);
  fs.writeFileSync(filePath, data);
  return filePath;
}

// ---------- /sub command ----------
const pending = new Map();
function createId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function cmdSub(ctx) {
  const query = (ctx.message?.text || '').replace(/^\/sub\s*/i, '').trim();
  if (!query) {
    return ctx.reply('🎬 Usage: `/sub <movie name>`\nඋදා: /sub interstellar', { parse_mode: 'Markdown' });
  }

  const status = await ctx.reply(`🔍 බයිස්කෝප් එකේ "${esc(query)}" search කරනවා...`);
  try {
    const results = await searchBaiscope(query);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});

    if (!results.length) {
      return ctx.reply('❌ Results නැහැ. වෙන movie name එකක් try කරන්න.');
    }

    const id = createId();
    pending.set(id, results);
    setTimeout(() => pending.delete(id), 600000).unref?.();

    const keyboard = {
      inline_keyboard: results.map((r, i) => [{
        text: r.title.slice(0, 60),
        callback_data: `bsc_${id}_${i}`
      }])
    };
    return ctx.reply('👇 Movie/Series එකක් තෝරන්න:', { reply_markup: keyboard });
  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    return ctx.reply(`❌ Search error: ${e.message}`);
  }
}

async function handleSubCallback(ctx) {
  const data = ctx.callbackQuery?.data || '';
  await ctx.answerCbQuery().catch(() => {});

  if (!data.startsWith('bsc_')) return;

  const [, id, idx] = data.split('_');
  const results = pending.get(id);
  if (!results) return ctx.reply('⌛ Expired. නැවත /sub කරන්න.');

  const picked = results[Number(idx)];
  if (!picked) return ctx.reply('❌ Result එක හමු වුණේ නැහැ.');

  const status = await ctx.reply('🔍 Subtitle link එක හොයනවා...');
  try {
    const info = await getSubtitleLink(picked.url);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});

    if (!info.links.length) {
      return ctx.reply('❌ මේ page එකේ subtitle download link එකක් හමු වුණේ නැහැ.\n\n' + picked.url);
    }

    // Download link එක direct file එකක් නම් download කරලා එවන්න
    const dl = info.links[0];
    const caption =
      `🎬 <b>${esc(info.title)}</b>\n` +
      `📝 සිංහල උපසිරැසි\n` +
      `🔗 ${esc(picked.url)}`;

    if (info.poster) {
      try {
        await ctx.replyWithPhoto(info.poster, { caption, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(caption, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(caption, { parse_mode: 'HTML' });
    }

    const dlStatus = await ctx.reply('⏳ Subtitle download කරනවා...');
    try {
      const filePath = await downloadSubtitle(dl.url, picked.url);
      await ctx.replyWithDocument(
        { source: fs.createReadStream(filePath), filename: path.basename(dl.url) || 'subtitle.srt' },
        { caption: `✅ ${info.title}\nPOWERED BY CINEMAX` }
      );
      try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
      await ctx.telegram.deleteMessage(ctx.chat.id, dlStatus.message_id).catch(() => {});
    } catch (e) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dlStatus.message_id).catch(() => {});
      // direct download fail නම් link එක දෙන්න
      return ctx.reply(`⚠️ Direct download fail වුණා.\n\n📥 මෙතනින් ගන්න:\n${dl.url}`);
    }
  } catch (e) {
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    return ctx.reply(`❌ ${e.message}`);
  }
}

module.exports = { cmdSub, handleSubCallback };
