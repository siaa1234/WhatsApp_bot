const { Telegraf } = require('telegraf');
const { ttdl, igdl, fbdown } = require('btch-downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API;
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';

const bot = new Telegraf(BOT_TOKEN);

// ================= SOCIAL CACHE =================
// callback_data 64 chars limit නිසා API response එක cache කරනවා
const socialCache = new Map();

// ================= SOCIAL HELPERS =================

// --- Social link detect කරන තැන ---
function detectPlatform(url) {
  if (/(tiktok\.com)/i.test(url)) return 'tiktok';
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  return null;
}

// --- Platform එක අනුව API call කරන තැන ---
// btch-downloader functions: ttdl (TikTok), igdl (Instagram), fbdown (Facebook)
async function getSocialLinks(platform, url) {
  try {
    if (platform === 'tiktok') {
      const r = await ttdl(url);
      console.log('TikTok response:', JSON.stringify(r).slice(0, 500));
      return r;
    }
    if (platform === 'instagram') {
      const r = await igdl(url);
      console.log('Instagram response:', JSON.stringify(r).slice(0, 500));
      return r;
    }
    if (platform === 'facebook') {
      const r = await fbdown(url);
      console.log('Facebook response:', JSON.stringify(r).slice(0, 500));
      return r;
    }
  } catch (e) {
    console.error('Social API error:', e.message);
  }
  return null;
}

// --- Quality එකට ගැලපෙන link එක තෝරන තැන ---
// TikTok:     { title, thumb, nowm, wm, audio }
// Facebook:   { title, thumb, HD, SD }
// Instagram:  { title, thumb, url: [links...] }
function pickQuality(info, quality) {
  // TikTok - nowm (no watermark)
  if (info.nowm) {
    if (quality === 'wm') return info.wm || info.nowm;
    return info.nowm;
  }
  // Facebook - HD / SD
  if (quality === 'hd' && info.HD) return info.HD;
  if (info.SD) return info.SD;
  if (quality === 'hd' && info.hd) return info.hd;
  if (info.sd) return info.sd;
  if (info.high) return info.high;
  // Instagram - url array එකක්
  if (Array.isArray(info.url) && info.url.length > 0) {
    return quality === 'hd' ? info.url[0] : info.url[info.url.length - 1];
  }
  if (typeof info.url === 'string') return info.url;
  return null;
}

// --- Buttons හදන තැන (platform එකේ qualities අනුව) ---
function buildQualityButtons(info, id) {
  const row = [];
  const hasHd = info.nowm || info.HD || info.hd || info.high || (Array.isArray(info.url) && info.url.length > 0);
  const hasSd = info.SD || info.sd || info.low || (Array.isArray(info.url) && info.url.length > 1);
  const hasWm = info.wm;

  if (hasHd) row.push({ text: '720p HD', callback_data: `dl_${id}_hd` });
  if (hasSd) row.push({ text: '360p SD', callback_data: `dl_${id}_sd` });
  if (hasWm) row.push({ text: 'Watermark', callback_data: `dl_${id}_wm` });

  if (row.length === 0) row.push({ text: '📥 Download', callback_data: `dl_${id}_hd` });
  return row;
}

// ================= MOVIE API =================

// ඔයාගේ API එක
async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) {
    console.error('Movie API error:', e.message);
    return null;
  }
}

// ================= START =================

bot.start((ctx) => ctx.reply(
  '🎬 Bot Online!\n\n' +
  '🎬 Film නමක් type කරන්න\n' +
  '📱 Social video link එකක් එවන්න\n\n' +
  'Supported: TikTok, Instagram, Facebook'
));

// ================= TEXT HANDLER =================

bot.on('text', async (ctx) => {
  const query = ctx.message.text;
  if (query.startsWith('/')) return;

  // ---------- 1. SOCIAL MEDIA LINK එකක් නම් ----------
  const platform = detectPlatform(query);
  if (platform) {
    const statusMsg = await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const info = await getSocialLinks(platform, query);

    if (!info) {
      return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');
    }

    // Cache කරලා ID එකක් හදනවා (10 min expiry)
    const id = Date.now().toString(36);
    socialCache.set(id, { platform, url: query, info });
    setTimeout(() => socialCache.delete(id), 600000);

    // Analyzing message එක delete කරනවා (fail වුනත් ඉස්සරහට යනවා)
    try { await ctx.deleteMessage(statusMsg.message_id); } catch (e) {}

    // Quality buttons හදනවා
    const buttons = buildQualityButtons(info, id);

    await ctx.replyWithPhoto(info.thumb || 'https://via.placeholder.com/300x450?text=No+Thumb', {
      caption: `🎬 *${(info.title || platform.toUpperCase()).slice(0, 100)}*\nQuality එකක් තෝරන්න 👇`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [buttons] }
    });
    return; // social link නම් movie search එකට යන්නේ නෑ
  }

  // ---------- 2. MOVIE SEARCH ----------
  await ctx.reply(`🔍 "${query}" හොයනවා...`);

  const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
  const omdb = await omdbRes.json();
  const myMovie = await searchMyAPI(query);

  if (omdb.Response === 'False' && !myMovie) return ctx.reply('Film එක හම්බුනේ නෑ');

  const title = omdb.Title || myMovie.title;
  const poster = omdb.Poster !== 'N/A' ? omdb.Poster : null;

  // Quality Buttons ටික දාන තැන
  await ctx.replyWithPhoto(poster || 'https://via.placeholder.com/300x450?text=No+Poster', {
    caption: `🎬 *${title}*\nQuality එකක් තෝරන්න 👇`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '480p', callback_data: `q_480p_${query}` }],
        [{ text: '720p HD', callback_data: `q_720p_${query}` }],
        [{ text: '1080p Full HD', callback_data: `q_1080p_${query}` }],
        [{ text: '🌐 Visit Site', url: 'https://hansaka.lk' }]
      ]
    }
  });
});

// ================= CALLBACK HANDLER =================

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // ---------- 1. SOCIAL DOWNLOAD CLICK: dl_<id>_<quality> ----------
  if (data.startsWith('dl_')) {
    await ctx.answerCbQuery();
    const [, id, quality] = data.split('_');
    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ මේ session එක expired වෙලා. Link එක ආයෙ එවන්න.');

    const { platform, info } = cached;
    const link = pickQuality(info, quality);

    if (!link) return ctx.reply('❌ මේ Quality එක මේ video එකට නෑ.');

    await ctx.reply(`✅ ${platform.toUpperCase()} - ${quality.toUpperCase()} Ready!`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📥 Download', url: link }],
          [{ text: '▶️ Watch in Telegram', callback_data: `send_${id}_${quality}` }]
        ]
      }
    });
    return;
  }

  // ---------- 2. TELEGRAM ඇතුලේ යවන එක: send_<id>_<quality> ----------
  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Uploading...');
    const [, id, quality] = data.split('_');
    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');

    const link = pickQuality(cached.info, quality);

    try {
      await ctx.replyWithVideo(link, {
        caption: `✅ ${cached.platform.toUpperCase()} ${quality.toUpperCase()}`
      });
    } catch (e) {
      console.error('Upload error:', e.message);
      ctx.reply('❌ Upload වුනේ නෑ. File එක ලොකු වැඩි වෙන්න ඇති. Download button එකෙන් ගන්න.');
    }
    return;
  }

  // ---------- 3. MOVIE QUALITY CLICK: q_<quality>_<name> ----------
  await ctx.answerCbQuery();
  const parts = data.split('_');
  const quality = parts[1];
  const movieName = parts.slice(2).join('_'); // film නමේ _ තියෙනවා නම් ඒවත් අල්ලගන්න

  await ctx.reply(`⏳ ${movieName} - ${quality} ලෝඩ් කරනවා...`);

  const myMovie = await searchMyAPI(movieName);

  // ඔයාගේ API එකේ quality අනුව link වෙනස් නම් මෙතන හදන්න
  // උදා: myMovie.links[quality]
  const fileLink = myMovie?.[quality] || myMovie?.downloadUrl || myMovie?.url;

  if (fileLink) {
    await ctx.reply(`✅ ${quality} Ready!\n\n🔗 ${fileLink}`, {
      reply_markup: {
        inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]]
      }
    });
  } else {
    await ctx.reply('❌ මේ Quality එක මගේ DB එකේ නෑ');
  }
});

// ================= ERROR HANDLING (crash නොවී ඉන්න) =================

bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  try { ctx.reply('⚠️ Error එකක් වුනා. නැවත උත්සාහ කරන්න.'); } catch (e) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

// ================= LAUNCH =================

bot.launch().then(() => console.log('Bot Started ✅'))
  .catch(err => {
    console.error('Launch failed:', err.message);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
