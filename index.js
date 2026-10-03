const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const { tikdow, igdow, fbdow } = require('btch-downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, 'alive.jpg');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

const bot = new Telegraf(BOT_TOKEN);

// ================= CACHE =================
const socialCache = new Map();
const movieCache = new Map();

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ================= HELPERS =================
function detectPlatform(url) {
  if (/(tiktok\.com)/i.test(url)) return 'tiktok';
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  return null;
}

async function getSocialLinks(platform, url) {
  try {
    if (platform === 'tiktok') return await tikdow(url);
    if (platform === 'instagram') return await igdow(url);
    if (platform === 'facebook') return await fbdow(url);
  } catch (e) {
    console.error('Social API error:', e.message);
  }
  return null;
}

function pickQuality(info, quality) {
  if (quality === 'hd') return info.hd || info.HD || info.high || info.nowm || info.sd || info.SD || info.low;
  if (quality === 'sd') return info.sd || info.SD || info.low || info.nowm || info.hd || info.HD || info.high;
  if (quality === 'wm') return info.wm;
  return null;
}

async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data)? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) {
    console.error('My API error:', e.message);
    return null;
  }
}

// ================= START - FIXED (No Markdown Error) =================
bot.start(async (ctx) => {
  const userName = ctx.from.first_name || 'User';
  const now = new Date();
  const date = now.toLocaleDateString('en-GB');
  const time = now.toLocaleTimeString('en-GB', { hour12: false });

  const caption = `👋 HI, ${userName} [•_•] I AM Active NOW 👾

╭─「 DATE INFORMATION 」
│📅 Date: ${date}
│⏰ Time: ${time}
╰──────────●●►

╭─「 STATUS DETAILS 」
│👤 User: ${userName}
│🧬 Version: 6.0.0
│🎈 Platform: Linux
│📡 Host: github
╰──────────●●►
╭─「 OUR film site 」
│🚀 cinemaxlk.vercel.app
╰──────────●●►
╭──────────●●►
│ Hello, I am alive now!!
╰──────────●●►`;

  try {
    if (fs.existsSync(ALIVE_LOCAL_PATH)) {
      await ctx.replyWithPhoto({ source: fs.createReadStream(ALIVE_LOCAL_PATH) }, {
        caption: caption,
        // parse_mode අයින් කලා - එතකොට fancy font නිසා error එන්නේ නෑ
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎬 Search Movie', switch_inline_query_current_chat: '' }],
            [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]
          ]
        }
      });
    } else {
      await ctx.reply(caption);
    }
  } catch (e) {
    console.error('Alive photo error:', e.message);
    await ctx.reply(caption);
  }
});

// ================= TEXT HANDLER =================
bot.on('text', async (ctx) => {
  const query = ctx.message.text?.trim();
  if (!query || query.startsWith('/')) return;

  // 1. SOCIAL LINK
  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const info = await getSocialLinks(platform, query);
    if (!info) return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');

    const id = createId();
    socialCache.set(id, { platform, url: query, info });
    setTimeout(() => socialCache.delete(id), 600000);

    const row = [];
    if (info.sd || info.SD || info.low) row.push({ text: '360p SD', callback_data: `dl_${id}_sd` });
    if (info.hd || info.HD || info.high || info.nowm) row.push({ text: '720p HD', callback_data: `dl_${id}_hd` });
    if (info.wm) row.push({ text: 'Watermark', callback_data: `dl_${id}_wm` });
    if (row.length === 0) row.push({ text: '📥 Download', callback_data: `dl_${id}_hd` });

    const thumb = info.thumb? info.thumb : { source: fs.createReadStream(ALIVE_LOCAL_PATH) };
    await ctx.replyWithPhoto(thumb, {
      caption: `🎬 ${info.title || platform.toUpperCase()} \nQuality එකක් තෝරන්න 👇`,
      reply_markup: { inline_keyboard: [row] }
    });
    return;
  }

  // 2. MOVIE SEARCH
  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try {
    const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
    const omdb = await omdbRes.json();
    const myMovie = await searchMyAPI(query);

    if (omdb.Response === 'False' &&!myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');

    const title = omdb.Title || myMovie?.title || query;
    const poster = omdb.Poster && omdb.Poster!== 'N/A'? omdb.Poster : null;

    const movieId = createId();
    movieCache.set(movieId, { query, title, myMovie, omdb });
    setTimeout(() => movieCache.delete(movieId), 600000);

    const photoSource = poster || (fs.existsSync(ALIVE_LOCAL_PATH)? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : 'https://via.placeholder.com/300x450?text=No+Poster');

    await ctx.replyWithPhoto(photoSource, {
      caption: `🎬 ${title}\nQuality එකක් තෝරන්න 👇`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '480p', callback_data: `mq_${movieId}_480p` }, { text: '720p HD', callback_data: `mq_${movieId}_720p` }],
          [{ text: '1080p Full HD', callback_data: `mq_${movieId}_1080p` }],
          [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]
        ]
      }
    });
  } catch (e) {
    console.error(e);
    ctx.reply('❌ Error එකක් ආවා.');
  }
});

// ================= CALLBACK HANDLER =================
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith('dl_')) {
    await ctx.answerCbQuery();
    const [, id, quality] = data.split('_');
    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');
    const link = pickQuality(cached.info, quality);
    if (!link) return ctx.reply('❌ මේ Quality එක නෑ.');
    await ctx.reply(`✅ ${cached.platform.toUpperCase()} - ${quality.toUpperCase()} Ready!`, {
      reply_markup: { inline_keyboard: [[{ text: '📥 Download', url: link }], [{ text: '▶️ Watch in Telegram', callback_data: `send_${id}_${quality}` }]] }
    });
    return;
  }

  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Uploading...');
    const [, id, quality] = data.split('_');
    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired.');
    const link = pickQuality(cached.info, quality);
    try {
      await ctx.replyWithVideo(link, { caption: `✅ ${cached.platform.toUpperCase()} ${quality.toUpperCase()}` });
    } catch (e) {
      ctx.reply('❌ Upload වුනේ නෑ. File එක ලොකු වැඩි. Download button එකෙන් ගන්න.');
    }
    return;
  }

  if (data.startsWith('mq_')) {
    await ctx.answerCbQuery();
    const parts = data.split('_');
    const id = parts[1];
    const quality = parts[2];
    const cached = movieCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Film නම ආයෙ එවන්න.');
    await ctx.reply(`⏳ ${cached.title} - ${quality} ලෝඩ් කරනවා...`);
    const fileLink = cached.myMovie?.[quality] || cached.myMovie?.links?.[quality] || cached.myMovie?.downloadUrl || cached.myMovie?.url;
    if (fileLink) {
      await ctx.reply(`✅ ${cached.title} - ${quality} Ready!\n\n🔗 ${fileLink}`, {
        reply_markup: { inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]] }
      });
    } else {
      await ctx.reply(`❌ ${quality} මගේ DB එකේ නෑ. Title එක: ${cached.title}`);
    }
    return;
  }
});

bot.launch().then(() => console.log('Bot Started ✅'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
