const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
// Facebook සහ Instagram සඳහා අවශ්‍ය downloader එක නැවත එක් කරන ලදී
const { igdl, fbdown } = require('btch-downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, 'alive.jpg');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

const bot = new Telegraf(BOT_TOKEN);

// ================= CACHE =================
const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ================= HELPERS =================
function detectPlatform(url) {
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  return null;
}

function detectDirectLink(url) {
  if (/(drive\.google\.com|docs\.google\.com)/i.test(url)) return 'gdrive';
  if (/^https?:\/\/.+/i.test(url)) return 'direct';
  return null;
}

function convertGoogleDriveLink(url) {
  const match = url.match(/\/d\/(.*?)\/|\?id=(.*?)(&|$)/);
  const fileId = match ? (match[1] || match[2]) : null;
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
}

async function getSocialLinks(platform, url) {
  try {
    let res;
    if (platform === 'instagram') {
      res = await igdl(url);
    } else if (platform === 'facebook') {
      res = await fbdown(url);
    }
    return res;
  } catch (e) {
    console.error('Social API error:', e.message);
  }
  return null;
}

function pickSocialQuality(info, quality) {
  if (!info) return null;
  const resultObj = info.data || info.result || info;
  let item = Array.isArray(resultObj) ? resultObj[0] : resultObj;
  if (!item) return null;

  let linksList = item.video || item.url || item.download || item.links || item;

  if (Array.isArray(linksList)) {
    const found = linksList.find(v => (v.quality || '').toLowerCase().includes(quality));
    if (found && found.url) return found.url;
    return linksList[0].url || linksList[0];
  }

  if (typeof linksList === 'object' && linksList !== null) {
    if (quality === 'hd') {
      return linksList.hd || linksList.HD || linksList.high || linksList.url || linksList.video;
    }
    if (quality === 'sd') {
      return linksList.sd || linksList.SD || linksList.low || linksList.url;
    }
    return linksList.url || linksList.hd || linksList.sd;
  }

  if (typeof linksList === 'string') {
    return linksList;
  }

  return null;
}

async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) {
    console.error('My API error:', e.message);
    return null;
  }
}

// ================= START =================
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

  // 1. INSTAGRAM / FACEBOOK LINK
  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const info = await getSocialLinks(platform, query);
    if (!info) return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');

    const id = createId();
    socialCache.set(id, { platform, url: query, info });
    setTimeout(() => socialCache.delete(id), 600000);

    const row = [
      { text: '📥 HD Video', callback_data: `soc_${id}_hd` },
      { text: '📥 SD Video', callback_data: `soc_${id}_sd` }
    ];

    const thumb = info.thumb || info.thumbnail || info.data?.thumbnail || (fs.existsSync(ALIVE_LOCAL_PATH) ? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : null);
    
    const replyOptions = {
      caption: `🎬 ${platform.toUpperCase()} Video එක සූදානම්!\nකරුණාකර අවශ්‍ය Quality එක තෝරන්න 👇`,
      reply_markup: { inline_keyboard: [row] }
    };

    if (thumb) {
      try {
        await ctx.replyWithPhoto(thumb, replyOptions);
        return;
      } catch (err) {}
    }
    await ctx.reply(replyOptions.caption, replyOptions.reply_markup);
    return;
  }

  // 2. DIRECT LINK / GOOGLE DRIVE LINK
  const directType = detectDirectLink(query);
  if (directType) {
    let finalUrl = query;
    if (directType === 'gdrive') {
      finalUrl = convertGoogleDriveLink(query);
    }

    const id = createId();
    directCache.set(id, { url: finalUrl });
    setTimeout(() => directCache.delete(id), 600000);

    await ctx.reply(`🔗 Link එක සාර්ථකව හඳුනාගැනිණි!`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📥 Send as Telegram Video (MP4)', callback_data: `send_${id}` }]
        ]
      }
    });
    return;
  }

  // 3. MOVIE SEARCH
  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try {
    const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
    const omdb = await omdbRes.json();
    const myMovie = await searchMyAPI(query);

    if (omdb.Response === 'False' && !myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');

    const title = omdb.Title || myMovie?.title || query;
    const poster = omdb.Poster && omdb.Poster !== 'N/A' ? omdb.Poster : null;

    const movieId = createId();
    movieCache.set(movieId, { query, title, myMovie, omdb });
    setTimeout(() => movieCache.delete(movieId), 600000);

    const photoSource = poster || (fs.existsSync(ALIVE_LOCAL_PATH) ? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : 'https://via.placeholder.com/300x450?text=No+Poster');

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

  // Instagram / Facebook Video Send Handler
  if (data.startsWith('soc_')) {
    await ctx.answerCbQuery('⏳ Video එක Download කරමින් පවතී...');
    const parts = data.split('_');
    const id = parts[1];
    const quality = parts[2];
    
    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');
    
    let link = pickSocialQuality(cached.info, quality);
    if (!link) return ctx.reply('❌ මේ link එකට අදාළ video file එක ලබාගත නොහැක.');

    const statusMsg = await ctx.reply(`⏳ ${cached.platform.toUpperCase()} video එක Telegram වෙත upload කරමින් පවතී...`);

    try {
      const response = await fetch(link);
      if (!response.ok) throw new Error('Failed to fetch video stream');
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await ctx.replyWithVideo(
        { source: buffer, filename: `video.mp4` }, 
        { caption: `✅ Successfully Downloaded & Uploaded!` }
      );
      
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}
    } catch (e) {
      console.error('Video upload error:', e.message);
      try {
        await ctx.replyWithVideo(link, { caption: `✅ Successfully Uploaded!` });
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}
      } catch (err) {
        ctx.reply('❌ Video එක upload කිරීම අසාර්ථකයි. File එක විශාල වැඩි විය හැක.');
      }
    }
    return;
  }

  // Direct Link / GDrive Video Send Handler
  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Video එක Download කරමින් පවතී...');
    const id = data.split('_')[1];
    
    const cached = directCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');
    
    const statusMsg = await ctx.reply(`⏳ Video එක Telegram වෙත upload කරමින් පවතී (මෙයට ටික වේලාවක් ගත විය හැක)...`);

    try {
      const response = await fetch(cached.url);
      if (!response.ok) throw new Error('Failed to fetch video stream from URL');
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await ctx.replyWithVideo(
        { source: buffer, filename: `video.mp4` }, 
        { caption: `✅ Successfully Downloaded & Uploaded!` }
      );
      
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}
    } catch (e) {
      console.error('Video upload error:', e.message);
      try {
        await ctx.replyWithVideo(cached.url, { caption: `✅ Successfully Uploaded!` });
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}
      } catch (err) {
        ctx.reply('❌ Video එක upload කිරීම අසාර්ථකයි. File එක 4GB වඩා වැඩි වීමට හෝ direct video format එකක් නොවීමට ඉඩ ඇත.');
      }
    }
    return;
  }

  // Movie Search Handler
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
