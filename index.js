const { Telegraf } = require('telegraf');
const { tikdow, igdow, fbdow } = require('btch-downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';

const bot = new Telegraf(BOT_TOKEN);

// ================= SOCIAL CACHE =================
// callback_data 64 chars limit නිසා link API response එක cache කරනවා
const socialCache = new Map();

// ================= HELPERS =================

// --- Social link detect කරන තැන ---
function detectPlatform(url) {
  if (/(tiktok\.com)/i.test(url)) return 'tiktok';
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  return null;
}

// --- Platform එක අනුව API call කරන තැන ---
async function getSocialLinks(platform, url) {
  try {
    if (platform === 'tiktok')    return await tikdow(url);
    if (platform === 'instagram') return await igdow(url);
    if (platform === 'facebook')  return await fbdow(url);
  } catch (e) {
    console.error('Social API error:', e.message);
  }
  return null;
}

// --- Quality එකට ගැලපෙන link එක තෝරන තැන ---
// TikTok: { title, thumb, sd, hd, nowm, wm, audio }
// Instagram: { title, thumb, high, low }
// Facebook: { title, thumb, HD, SD }
function pickQuality(info, quality) {
  if (quality === 'hd') {
    return info.hd || info.HD || info.high || info.nowm || info.sd || info.SD || info.low;
  }
  // sd / low / fallback
  return info.sd || info.SD || info.low || info.nowm || info.hd || info.HD || info.high;
}

// ================= MOVIE API =================

// ඔයාගේ API එක
async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) { return null; }
}

// ================= START =================

bot.start((ctx) => ctx.reply('🎬 Bot Online! Film නමක් හෝ Social media video link එකක් එවන්න\n\n📱 Supported: TikTok, Instagram, Facebook\n🎬 Movies: Film නමක් type කරන්න'));

// ================= TEXT HANDLER =================

bot.on('text', async (ctx) => {
  const query = ctx.message.text;
  if (query.startsWith('/')) return;

  // ---------- 1. SOCIAL MEDIA LINK එකක් නම් ----------
  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const info = await getSocialLinks(platform, query);

    if (!info) {
      return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');
    }

    // Cache කරලා ID එකක් හදනවා
    const id = Date.now().toString(36);
    socialCache.set(id, { platform, url: query, info });
    // 10 මිනිත්තලයකට පස්සේ cache entry එක delete
    setTimeout(() => socialCache.delete(id), 600000);

    // API එකෙන් එන qualities අනුව buttons හදනවා
    const row = [];
    if (info.sd || info.SD || info.low || info.nowm) row.push({ text: '360p SD', callback_data: `dl_${id}_sd` });
    if (info.hd || info.HD || info.high || info.nowm) row.push({ text: '720p HD', callback_data: `dl_${id}_hd` });
    if (info.wm) row.push({ text: 'Watermark', callback_data: `dl_${id}_wm` });

    if (row.length === 0) row.push({ text: '📥 Download', callback_data: `dl_${id}_hd` });

    await ctx.replyWithPhoto(info.thumb || 'https://via.placeholder.com/300x450?text=No+Thumb', {
      caption: `🎬 *${info.title || platform.toUpperCase()} Video*\nQuality එකක් තෝරන්න 👇`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [row] }
    });
    return; // social link එකක් නම් movie search එකට යන්නේ නෑ
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
    if (!cached) return ctx.reply('⌛ Session expired.');

    const link = pickQuality(cached.info, quality);

    try {
      await ctx.replyWithVideo(link, {
        caption: `✅ ${cached.platform.toUpperCase()} ${quality.toUpperCase()}`
      });
    } catch (e) {
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
    // Link එක direct යවනවා + Download button එකක්
    await ctx.reply(`✅ ${quality} Ready!\n\n🔗 ${fileLink}`, {
      reply_markup: {
        inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]]
      }
    });
  } else {
    await ctx.reply('❌ මේ Quality එක මගේ DB එකේ නෑ');
  }
});

// ================= LAUNCH =================

bot.launch().then(() => console.log('Bot Started ✅'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
