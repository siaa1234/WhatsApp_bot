const fs = require('fs');
const os = require('os');
const path = require('path');
const { Telegraf } = require('telegraf');
const { ttdl, igdl, fbdown } = require('btch-downloader');
const youtubedl = require('youtube-dl-exec');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, 'alive.jpg');
// IP block වුණොත් browser එකෙන් export කරපු cookies.txt මෙතනට දාන්න
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

// Download/upload වලට වෙලාව යන නිසා handler timeout අයින් කරනවා
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

// ================= CACHE =================
const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ================= HELPERS =================
function detectPlatform(url) {
  if (/(tiktok\.com)/i.test(url)) return 'tiktok';
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  if (/(youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
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

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ytExtraOpts() {
  return fs.existsSync(COOKIES_PATH) ? { cookies: COOKIES_PATH } : {};
}

// ---------- YouTube (yt-dlp) ----------
async function getYouTubeInfo(url) {
  try {
    return await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true,
      noCheckCertificates: true,
      ...ytExtraOpts(),
    });
  } catch (e) {
    console.error('YT info error:', e.message);
    return null;
  }
}

async function downloadYouTube(url, quality) {
  const base = `yt_${createId()}`;
  await youtubedl(url, {
    format: `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/b[height<=${quality}][ext=mp4]/b[height<=${quality}]/b`,
    mergeOutputFormat: 'mp4',
    output: path.join(os.tmpdir(), `${base}.%(ext)s`),
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    ...ytExtraOpts(),
  });
  const file = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(base));
  if (!file) throw new Error('Downloaded file not found');
  return path.join(os.tmpdir(), file);
}

// ---------- TikTok / Instagram / Facebook ----------
async function getSocialLinks(platform, url) {
  try {
    let res;
    if (platform === 'tiktok') res = await ttdl(url);
    else if (platform === 'instagram') res = await igdl(url);
    else if (platform === 'facebook') res = await fbdown(url);
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
    return linksList[quality] || linksList.hd || linksList.sd || linksList.url;
  }

  if (typeof linksList === 'string') return linksList;
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

  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);

    const id = createId();

    // ---------- YouTube ----------
    if (platform === 'youtube') {
      const yt = await getYouTubeInfo(query);
      if (!yt) {
        return ctx.reply('❌ YouTube video එක ලබාගැනීමට නොහැකි විය. Link එක පරීක්ෂා කරන්න.');
      }

      socialCache.set(id, {
        platform: 'youtube',
        url: query,
        info: { title: yt.title, uploader: yt.uploader || yt.channel }
      });
      setTimeout(() => socialCache.delete(id), 600000);

      const keyboard = [
        [
          { text: '144p', callback_data: `soc_${id}_144` },
          { text: '360p', callback_data: `soc_${id}_360` },
          { text: '480p', callback_data: `soc_${id}_480` }
        ],
        [
          { text: '720p HD', callback_data: `soc_${id}_720` },
          { text: '1080p FHD', callback_data: `soc_${id}_1080` }
        ]
      ];

      const mins = yt.duration
        ? `${Math.floor(yt.duration / 60)}:${String(yt.duration % 60).padStart(2, '0')}`
        : 'N/A';
      const captionText =
        `🎬 <b>${escapeHtml(yt.title)}</b>\n\n` +
        `👤 <b>Channel:</b> ${escapeHtml(yt.uploader || yt.channel)}\n` +
        `👁️ <b>Views:</b> ${yt.view_count ?? 'N/A'}\n` +
        `⏱️ <b>Duration:</b> ${mins}\n\n` +
        `👇 අවශ්‍ය Quality එක තෝරන්න:`;

      const opts = {
        caption: captionText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      };

      if (yt.thumbnail) {
        try { await ctx.replyWithPhoto(yt.thumbnail, opts); return; } catch (err) {}
      }
      await ctx.reply(captionText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    }

    // ---------- TikTok / Instagram / Facebook ----------
    const info = await getSocialLinks(platform, query);
    if (!info) return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');

    socialCache.set(id, { platform, url: query, info });
    setTimeout(() => socialCache.delete(id), 600000);

    const resultObj = info.data || info.result || info;
    const item = Array.isArray(resultObj) ? resultObj[0] : resultObj;

    const title = item?.title || 'Unknown Title';
    const author = item?.author || item?.channel || item?.page || 'Unknown Creator';
    const views = item?.views || item?.viewCount || 'N/A';
    const date = item?.date || item?.uploadDate || 'N/A';
    const comments = item?.comments || 'N/A';

    const keyboard = [
      [
        { text: '📥 HD Video', callback_data: `soc_${id}_hd` },
        { text: '📥 SD Video', callback_data: `soc_${id}_sd` }
      ]
    ];

    const thumb = item?.thumb || item?.thumbnail || info.thumb ||
      (fs.existsSync(ALIVE_LOCAL_PATH) ? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : null);

    const captionText =
      `🎬 <b>${escapeHtml(title)}</b>\n\n` +
      `👤 <b>Page/Creator:</b> ${escapeHtml(author)}\n` +
      `👁️ <b>Views:</b> ${escapeHtml(views)}\n` +
      `📅 <b>Release Date:</b> ${escapeHtml(date)}\n` +
      `💬 <b>Comments:</b> ${escapeHtml(comments)}\n\n` +
      `👇 අවශ්‍ය Quality එක තෝරන්න:`;

    const replyOptions = {
      caption: captionText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    };

    if (thumb) {
      try {
        await ctx.replyWithPhoto(thumb, replyOptions);
        return;
      } catch (err) {}
    }

    await ctx.reply(captionText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  // ---------- Direct links ----------
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

  // ---------- Movie search ----------
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

    const photoSource = poster ||
      (fs.existsSync(ALIVE_LOCAL_PATH)
        ? { source: fs.createReadStream(ALIVE_LOCAL_PATH) }
        : 'https://via.placeholder.com/300x450?text=No+Poster');

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

  // ---------- Social / YouTube download ----------
  if (data.startsWith('soc_')) {
    await ctx.answerCbQuery('⏳ Video එක Download කරමින් පවතී...');
    const [, id, quality] = data.split('_');

    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');

    const statusMsg = await ctx.reply('⏳ Video එක Download කරමින් පවතී...');
    const deleteStatus = () =>
      ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    // ----- YouTube -----
    if (cached.platform === 'youtube') {
      let filePath;
      try {
        filePath = await downloadYouTube(cached.url, quality);
        const sizeMB = fs.statSync(filePath).size / 1024 / 1024;

        if (sizeMB > 49) {
          await deleteStatus();
          return ctx.reply(`❌ File එක ${sizeMB.toFixed(1)}MB. Telegram bot limit එක 50MB. අඩු quality එකක් තෝරන්න.`);
        }

        await ctx.replyWithVideo(
          { source: fs.createReadStream(filePath), filename: 'video.mp4' },
          { caption: `✅ ${cached.info.title} (${quality}p)`, supports_streaming: true }
        );
        await deleteStatus();
      } catch (e) {
        console.error('YT download error:', e.message);
        await deleteStatus();
        ctx.reply('❌ Download කිරීම අසාර්ථකයි. පසුව උත්සාහ කරන්න.');
      } finally {
        if (filePath) fs.unlink(filePath, () => {});
      }
      return;
    }

    // ----- TikTok / Instagram / Facebook -----
    const link = pickSocialQuality(cached.info, quality);
    try {
      if (!link) throw new Error('No link');
      await ctx.replyWithVideo(link, { caption: `✅ Successfully Uploaded! (${quality.toUpperCase()})` });
    } catch (e) {
      try {
        if (!link) throw new Error('No link');
        const response = await fetch(link);
        if (!response.ok) throw new Error('fetch failed');
        const buffer = Buffer.from(await response.arrayBuffer());
        await ctx.replyWithVideo(
          { source: buffer, filename: 'video.mp4' },
          { caption: '✅ Successfully Uploaded!' }
        );
      } catch (err) {
        await ctx.reply('❌ Video එක upload කිරීම අසාර්ථකයි. File එක විශාල වැඩි විය හැක.');
      }
    }
    await deleteStatus();
    return;
  }

  // ---------- Direct link send ----------
  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Video එක Download කරමින් පවතී...');
    const id = data.split('_')[1];

    const cached = directCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Link එක ආයෙ එවන්න.');

    const statusMsg = await ctx.reply('⏳ Video එක Telegram වෙත upload කරමින් පවතී...');
    const deleteStatus = () =>
      ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    try {
      const response = await fetch(cached.url);
      if (!response.ok) throw new Error('Failed to fetch video stream from URL');

      const buffer = Buffer.from(await response.arrayBuffer());

      await ctx.replyWithVideo(
        { source: buffer, filename: 'video.mp4' },
        { caption: '✅ Successfully Downloaded & Uploaded!' }
      );
      await deleteStatus();
    } catch (e) {
      console.error('Video upload error:', e.message);
      try {
        await ctx.replyWithVideo(cached.url, { caption: '✅ Successfully Uploaded!' });
        await deleteStatus();
      } catch (err) {
        await deleteStatus();
        ctx.reply('❌ Video එක upload කිරීම අසාර්ථකයි. File එක 50MB වඩා වැඩි වීමට හෝ direct video format එකක් නොවීමට ඉඩ ඇත.');
      }
    }
    return;
  }

  // ---------- Movie quality ----------
  if (data.startsWith('mq_')) {
    await ctx.answerCbQuery();
    const [, id, quality] = data.split('_');
    const cached = movieCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired. Film නම ආයෙ එවන්න.');

    await ctx.reply(`⏳ ${cached.title} - ${quality} ලෝඩ් කරනවා...`);
    const fileLink =
      cached.myMovie?.[quality] ||
      cached.myMovie?.links?.[quality] ||
      cached.myMovie?.downloadUrl ||
      cached.myMovie?.url;

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
