const fs = require('fs');
const path = require('path');

const OMDB_API = process.env.OMDB_API || 'c011220a';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; //.env එකෙන් විතරක් ගන්න
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, '..', 'alive.jpg');

const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();

// Working Cobalt Instances (2026)
const COBALT_INSTANCES = [
  'https://api.cobalt.tools/api/json',
  'https://co.api.cobalt.tools/api/json',
  'https://api.cobalt.sh/api/json',
  'https://cobalt-api.kwiatekmiki.com/api/json'
];

function createId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function detectPlatform(url) {
  if (/(tiktok\.com)/i.test(url)) return 'tiktok';
  if (/(instagram\.com)/i.test(url)) return 'instagram';
  if (/(facebook\.com|fb\.watch|fb\.me)/i.test(url)) return 'facebook';
  if (/(youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
  return null;
}

function detectDirectLink(url) {
  if (/(drive\.google\.com|docs\.google\.com)/i.test(url)) return 'gdrive';
  if (/^https?:\/\/.+/i.test(url) &&!detectPlatform(url)) return 'direct';
  return null;
}

function convertGoogleDriveLink(url) {
  const match = url.match(/\/d\/(.*?)\/|\?id=(.*?)(&|$)/);
  const fileId = match? (match[1] || match[2]) : null;
  if (fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match? match[1] : null;
}

async function getYouTubeMetadata(url) {
  try {
    if (!YOUTUBE_API_KEY) {
      console.log("YOUTUBE_API_KEY not set, skipping metadata");
      return { title: "YouTube Video", author: "Unknown", views: "N/A", date: "N/A", thumb: null, url };
    }
    const videoId = extractYouTubeId(url);
    if (!videoId) return null;
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${YOUTUBE_API_KEY}`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;
    const item = data.items[0];
    return {
      title: item.snippet.title,
      author: item.snippet.channelTitle,
      views: item.statistics.viewCount || 'N/A',
      date: item.snippet.publishedAt? item.snippet.publishedAt.split('T')[0] : 'N/A',
      thumb: item.snippet.thumbnails?.high?.url || null,
      url: url
    };
  } catch (e) {
    console.log("YT meta error", e.message);
    return null;
  }
}

async function getCobaltDownloadLink(url, quality = '720') {
  for (const apiUrl of COBALT_INSTANCES) {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, videoQuality: quality, vCodec: 'h264', filenamePattern: 'basic' })
      });
      const data = await res.json();
      if (data.status === 'error' || data.status === 'rate-limit') {
        console.log(`Cobalt error at ${apiUrl}: ${data.text}`);
        continue;
      }
      if (data.url) return data.url;
      if (data.picker && data.picker.length > 0) {
        // best quality picker එක ගන්න
        const sorted = data.picker.sort((a,b) => (b.bitrate||0) - (a.bitrate||0));
        return sorted[0].url;
      }
    } catch (e) {
      console.log(`Cobalt failed ${apiUrl}: ${e.message}`);
    }
  }
  return null;
}

async function fetchSocialMediaVideo(url, platform) {
  // 1. Cobalt try
  const cobaltLink = await getCobaltDownloadLink(url, '720');
  if (cobaltLink) {
    return { url: cobaltLink, title: `${platform.toUpperCase()} Video`, thumb: null };
  }
  // 2. Fallback APIs try කරන්න එපා - වැඩ නෑ, ඒ නිසා null
  return null;
}

function buildCaption(platform, title) {
  const pName = platform.toUpperCase();
  const cleanTitle = (title || 'No Title').toString().replace(/_/g, ' ').slice(0, 80);
  return `🟨🟥 ${pName} DOWNLOADER 🟥🟨\n\n🟡 Title: ${cleanTitle}\n🔴 Powered By Cinemax\n\n⬇️ Ready to Download!\n\n| 🌐 Web Site: cinemaxlk.vercel.app\n❤️💛 POWERED BY CINEMAX 💛❤️`;
}

async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data)? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) { return null; }
}

async function handleText(ctx) {
  const query = ctx.message.text?.trim();
  if (!query || query.startsWith('/')) return;

  const platform = detectPlatform(query);
  if (platform) {
    const statusMsg = await ctx.reply(`🔍 ${platform.toUpperCase()} වීඩියෝ එක analyze කරනවා...`);
    const id = createId();

    if (platform === 'youtube') {
      const ytInfo = await getYouTubeMetadata(query);
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}

      // Metadata නැතත් quality buttons පෙන්වන්න
      const info = ytInfo || { title: "YouTube Video", author: "Unknown", views: "N/A", date: "N/A", thumb: null };
      socialCache.set(id, { platform: 'youtube', url: query });
      setTimeout(() => socialCache.delete(id), 600000);

      const keyboard = [
        [{ text: '360p', callback_data: `soc_${id}_360` }, { text: '480p', callback_data: `soc_${id}_480` }],
        [{ text: '720p HD', callback_data: `soc_${id}_720` }, { text: '1080p FHD', callback_data: `soc_${id}_1080` }]
      ];
      const captionText = `🎬 **${info.title}**\n\n👤 **Channel:** ${info.author}\n👁️ **Views:** ${info.views}\n📅 **Date:** ${info.date}\n\n👇 අවශ්‍ය Quality එක තෝරන්න:`;

      if (info.thumb) {
        try {
          await ctx.replyWithPhoto(info.thumb, { caption: captionText, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
          return;
        } catch {}
      }
      await ctx.reply(captionText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    const videoData = await fetchSocialMediaVideo(query, platform);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}

    if (videoData && videoData.url) {
      socialCache.set(id, { platform, videoUrl: videoData.url });
      setTimeout(() => socialCache.delete(id), 600000);
      const captionText = buildCaption(platform, videoData.title);
      const keyboard = [[{ text: '📥 Video එක ලබාගන්න (Get Video)', callback_data: `soc_${id}_get` }]];
      if (videoData.thumb) {
        try { await ctx.replyWithPhoto(videoData.thumb, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); return; } catch {}
      }
      await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } else {
      return ctx.reply('❌ වීඩියෝ එක හොයාගන්න බැරි වුණා. Cobalt API ටික busy. විනාඩියකින් ආයෙ Link එක එවන්න.\nLink එක Public එකක්ද කියලත් බලන්න.');
    }
  }

  const directType = detectDirectLink(query);
  if (directType) {
    let finalUrl = query;
    if (directType === 'gdrive') finalUrl = convertGoogleDriveLink(query);
    const id = createId();
    directCache.set(id, { url: finalUrl });
    setTimeout(() => directCache.delete(id), 600000);
    await ctx.reply(`🔗 Link එක හඳුනාගැනිණි!`, { reply_markup: { inline_keyboard: [[{ text: '📥 Send as Video', callback_data: `send_${id}` }]] } });
    return;
  }

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
      caption: `🎬 ${title}\nQuality තෝරන්න 👇`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '480p', callback_data: `mq_${movieId}_480p` }, { text: '720p HD', callback_data: `mq_${movieId}_720p` }],
          [{ text: '1080p Full HD', callback_data: `mq_${movieId}_1080p` }],
          [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]
        ]
      }
    });
  } catch (e) {
    ctx.reply('❌ Error එකක් ආවා.');
  }
}

async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;

  if (data.startsWith('soc_')) {
    await ctx.answerCbQuery('⏳ Downloading...');
    const parts = data.split('_');
    const id = parts[1];
    const qualityOrGet = parts[2];

    const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Expired! නැවත Link එක එවන්න.');

    let videoLink = cached.videoUrl;
    if (cached.platform === 'youtube') {
      const waitMsg = await ctx.reply(`⏳ ${qualityOrGet}p quality එක හොයනවා...`);
      videoLink = await getCobaltDownloadLink(cached.url, qualityOrGet);
      try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch {}
    }

    if (!videoLink) return ctx.reply('❌ Link එක ගන්න බැරිවුනා. Cobalt limit වෙලා ඇති. 1min ඉඳලා ආයෙ try කරන්න.');

    const statusMsg = await ctx.reply(`⏳ Telegram එකට Upload වෙනවා...`);
    try {
      // Direct URL එකෙන් upload කරන්න try කිරීම
      await ctx.replyWithVideo(videoLink, { caption: `✅ Done! POWERED BY CINEMAX` });
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    } catch (e) {
      console.log("Direct URL failed, trying buffer...", e.message);
      try {
        const res = await fetch(videoLink);
        if (!res.ok) throw new Error("fetch failed");
        const arrayBuf = await res.arrayBuffer();
        // 48MB ට වඩා ලොකු නම් Telegram bot limit
        if (arrayBuf.byteLength > 48 * 1024 * 1024) {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
          return ctx.reply(`⚠️ File එක ලොකුයි (${(arrayBuf.byteLength/1024/1024).toFixed(1)}MB). Telegram Bot limit 50MB.\n\nDirect Download Link: \n${videoLink}`);
        }
        const buf = Buffer.from(arrayBuf);
        await ctx.replyWithVideo({ source: buf, filename: 'video.mp4' }, { caption: `✅ Done! POWERED BY CINEMAX` });
      } catch (err) {
        console.log("Buffer upload failed", err.message);
        ctx.reply(`❌ Upload Fail. Link එකෙන් download කරන්න:\n${videoLink}`);
      }
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    }
    return;
  }

  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Downloading...');
    const id = data.split('_')[1];
    const cached = directCache.get(id);
    if (!cached) return ctx.reply('⌛ Expired.');
    const statusMsg = await ctx.reply(`⏳ Uploading...`);
    try {
      await ctx.replyWithVideo(cached.url, { caption: `✅ Done! POWERED BY CINEMAX` });
    } catch {
      ctx.reply('❌ Fail. Direct Link එක වැඩ නෑ.');
    }
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    return;
  }

  if (data.startsWith('mq_')) {
    await ctx.answerCbQuery();
    const parts = data.split('_');
    const id = parts[1];
    const quality = parts[2];
    const cached = movieCache.get(id);
    if (!cached) return ctx.reply('⌛ Expired.');
    const fileLink = cached.myMovie?.[quality] || cached.myMovie?.links?.[quality] || cached.myMovie?.downloadUrl;
    if (fileLink) await ctx.reply(`✅ ${cached.title} - ${quality} Ready!\n\n🔗 ${fileLink}`, { reply_markup: { inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]] } });
    else await ctx.reply(`❌ ${quality} නෑ.`);
    return;
  }
}

module.exports = { handleText, handleCallback };
