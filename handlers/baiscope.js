// handlers/baiscope.js — බයිස්කෝප් සිංහලෙන් subtitle scraper (v2)
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'https://www.baiscope.lk';

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
  const seen = new Set();

  $('a[href*="/movies/"], a[href*="/tv/"]').each((i, el) => {
    const href = $(el).attr('href') || '';
    // thumb/logo links නෙවෙයි — text එකක් තියෙන link විතරක්
    const text = ($(el).attr('title') || $(el).text() || '').trim();
    if (!text || text.length < 5) return;
    if (seen.has(href)) return;
    seen.add(href);
    results.push({ title: text, url: href.startsWith('http') ? href : BASE + href });
  });

  return results.slice(0, 10);
}

// ---------- Download link extraction (strict) ----------
async function getSubtitleLink(pageUrl) {
  const { data: html } = await axios.get(pageUrl, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(html);

  const links = [];
  const seen = new Set();

  $('a').each((i, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || seen.has(href)) return;

    const text = ($(el).text() || '').toLowerCase();
    const lower = href.toLowerCase();

    // ✅ REAL subtitle links විතරක් ගන්න:
    const isReal =
      lower.includes('dl.baiscope.lk') ||          // dl subdomain
      lower.includes('/download') ||               // /download path
      /\.(zip|rar|7z|srt)(\?|$)/.test(lower);      // direct file

    // ❌ Ads / social / internal links exclude:
    const isJunk =
      lower.includes('advertise') ||
      lower.includes('facebook') || lower.includes('twitter') ||
      lower.includes('t.me') || lower.includes('telegram') ||
      lower.includes('youtube') ||
      lower.includes('/category/') || lower.includes('/tag/') ||
      href === '#' || lower.startsWith('javascript') ||
      lower.includes('bit.ly') || lower.includes('cutt.ly') ||
      lower.includes('shrinkme') || lower.includes('clicknupload') === false && false;

    if (isReal && !isJunk) {
      seen.add(href);
      const label = text || href.split('/').pop();
      links.push({ url: href.startsWith('http') ? href : BASE + href, label });
    }
  });

  // priority sort: dl.baiscope direct file links උඩින්ම
  links.sort((a, b) => {
    const score = u => u.url.toLowerCase().includes('dl.baiscope') ? 0 :
      /\.(zip|rar|7z|srt)/.test(u.url.toLowerCase()) ? 1 :
      u.url.toLowerCase().includes('/download') ? 2 : 3;
    return score(a) - score(b);
  });

  const poster = $('meta[property="og:image"]').attr('content') || '';
  const title = ($('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content') || 'Unknown').trim();

  return { title, poster, links };
}

// ---------- Download subtitle file ----------
async function downloadSubtitle(url, referer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-'));
  const { data, headers } = await axios.get(url, {
    headers: { ...HEADERS, Referer: referer },
    responseType: 'arraybuffer',
    timeout: 60000,
    maxRedirects: 5
  });

  // ලැබුණේ HTML page එකක් නම් (redirect/ad page) — fail කරන්න
  const ct = headers['content-type'] || '';
  if (ct.includes('text/html')) throw new Error('INTERMEDIATE_PAGE');

  const cd = headers['content-disposition'] || '';
  const filename = (cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]
    || url.split('/').pop().split('?')[0] || 'subtitle').replace(/["']/g, '');

  const ext = path.extname(filename) || '.zip';
  const filePath = path.join(dir, `subtitle${ext}`);
  fs.writeFileSync(filePath, data);
  return filePath;
}

const pending = new Map();
function createId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- /sub command ----------
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

  // bsc_ + dl link pick (bscd_) or movie pick
  if (data.startsWith('bscd_')) {
    const [, id, idx] = data.split('_');
    const cached = pending.get(id);
    if (!cached) return ctx.reply('⌛ Expired. නැවත /sub කරන්න.');
    const dl = cached.links[Number(idx)];
    if (!dl) return ctx.reply('❌ Link එක හමු වුණේ නැහැ.');

    const status = await ctx.reply('⏳ Subtitle download කරනවා...');
    try {
      const filePath = await downloadSubtitle(dl.url, cached.pageUrl);
      await ctx.replyWithDocument(
        { source: fs.createReadStream(filePath), filename: path.basename(dl.url) || 'subtitle.zip' },
        { caption: `✅ ${cached.title}\nPOWERED BY CINEMAX` }
      );
      try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    } catch (e) {
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
      return ctx.reply(
        `⚠️ Direct download වැඩ කරන්නේ නැහැ (${e.message === 'INTERMEDIATE_PAGE' ? 'ad/redirect page එකක්' : e.message}).\n\n📥 Browser එකෙන් ගන්න:\n${dl.url}`
      );
    }
    return;
  }

  if (data.startsWith('bsc_')) {
    const [, id, idx] = data.split('_');
    const results = pending.get(id);
    if (!results) return ctx.reply('⌛ Expired. නැවත /sub කරන්න.');

    const picked = results[Number(idx)];
    if (!picked) return ctx.reply('❌ Result එක හමු වුණේ නැහැ.');

    const status = await ctx.reply('🔍 Subtitle link එක හොයනවා...');
    try {
      const info = await getSubtitleLink(picked.url);
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});

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

      if (!info.links.length) {
        console.log('[baiscope] no links found for', picked.url);
        return ctx.reply(
          '❌ මේ page එකේ subtitle link එක auto-detect කරන්න බැහැ.\n\n📥 Browser එකෙන් ගන්න:\n' + picked.url
        );
      }

      const linkId = createId();
      pending.set(linkId, { ...info, pageUrl: picked.url });
      setTimeout(() => pending.delete(linkId), 600000).unref?.();

      const keyboard = {
        inline_keyboard: info.links.slice(0, 5).map((l, i) => [{
          text: (l.label || 'Download').slice(0, 40),
          callback_data: `bscd_${linkId}_${i}`
        }])
      };
      return ctx.reply(`📥 Download link ${info.links.length}ක් හමු වුණා — එකක් තෝරන්න:`, { reply_markup: keyboard });
    } catch (e) {
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
      return ctx.reply(`❌ ${e.message}`);
    }
  }
}

module.exports = { cmdSub, handleSubCallback };
