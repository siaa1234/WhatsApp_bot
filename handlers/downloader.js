const fs = require('fs');
const path = require('path');

const OMDB_API = process.env.OMDB_API || 'c011220a';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyBAd2fAvPkZNaQn5B45vkqwaIalnG8qUrc'; 
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const ALIVE_LOCAL_PATH = path.join(__dirname, '..', 'alive.jpg');

const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();

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
  if (/^https?:\/\/.+/i.test(url) && !detectPlatform(url)) return 'direct';
  return null;
}

function convertGoogleDriveLink(url) {
  const match = url.match(/\/d\/(.*?)\/|\?id=(.*?)(&|$)/);
  const fileId = match ? (match[1] || match[2]) : null;
  if (fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

// YouTube Metadata ලබා ගැනීම
async function getYouTubeMetadata(url) {
  try {
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
      date: item.snippet.publishedAt ? item.snippet.publishedAt.split('T')[0] : 'N/A',
      thumb: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      url: url
    };
  } catch (e) {
    return null;
  }
}

// Cobalt API හරහා YouTube හෝ අනෙකුත් Social Media ලින්ක් එකකට අදාළ Quality එක ලබා ගැනීම
async function getCobaltDownloadLink(url, quality = '720') {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, videoQuality: quality, vCodec: 'h264' })
    });
    const data = await res.json();
    if (data) {
      if (data.url) return data.url;
      if (data.picker && data.picker.length > 0) return data.picker[0].url;
    }
  } catch (e) {}
  return null;
}

// Multi-API Fetcher (Instagram, TikTok, Facebook සඳහා)
async function fetchSocialMediaVideo(url, platform) {
  // Method 1: Cobalt Direct (Best for IG, FB, TikTok)
  const cobaltLink = await getCobaltDownloadLink(url, '720');
  if (cobaltLink) {
    return { url: cobaltLink, title: `${platform.toUpperCase()} Video`, thumb: null };
  }

  // Method 2: Tiklydown Fallback
  try {
    const res1 = await fetch(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`);
    const data1 = await res1.json();
    if (data1 && (data1.video || data1.url)) {
      return {
        url: data1.video?.noWatermark || data1.video || data1.url,
        title: data1.title || `${platform} Video`,
        thumb: data1.cover || data1.thumbnail || null
      };
    }
  } catch (e) {}

  // Method 3: VKR Downloader Fallback
  try {
    const res2 = await fetch(`https://api.vkrdown.com/api/download?url=${encodeURIComponent(url)}`);
    const data2 = await res2.json();
    if (data2 && data2.data && data2.data.length > 0) {
      const bestVideo = data2.data.find(v => v.type === 'video' || v.format === 'mp4') || data2.data[0];
      return {
        url: bestVideo.url,
        title: data2.title || `${platform} Video`,
        thumb: data2.thumbnail || null
      };
    }
  } catch (e) {}

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
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];
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

    // YouTube සඳහා වෙනම Quality බටන් පෙන්වීම
    if (platform === 'youtube') {
      const ytInfo = await getYouTubeMetadata(query);
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}

      if (!ytInfo) return ctx.reply('❌ YouTube වීඩියෝ විස්තර ලබාගැනීමට නොහැකි විය. Link එක පරීක්ෂා කරන්න.');

      socialCache.set(id, { platform: 'youtube', url: query });
      setTimeout(() => socialCache.delete(id), 600000);

      const keyboard = [
        [
          { text: '360p', callback_data: `soc_${id}_360` },
          { text: '480p', callback_data: `soc_${id}_480` }
        ],
        [
          { text: '720p HD', callback_data: `soc_${id}_720` },
          { text: '1080p FHD', callback_data: `soc_${id}_1080` }
        ]
      ];

      const captionText = `🎬 **${ytInfo.title}**\n\n` +
                          `👤 **Channel:** ${ytInfo.author}\n` +
                          `👁️ **Views:** ${Number(ytInfo.views).toLocaleString()}\n` +
                          `📅 **Date:** ${ytInfo.date}\n\n` +
                          `👇 අවශ්‍ය Quality එක තෝරන්න:`;

      if (ytInfo.thumb) {
        try {
          await ctx.replyWithPhoto(ytInfo.thumb, { caption: captionText, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
          return;
        } catch (err) {}
      }
      await ctx.reply(captionText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    // Instagram, TikTok, Facebook සඳහා
    const videoData = await fetchSocialMediaVideo(query, platform);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}

    if (videoData && videoData.url) {
      socialCache.set(id, { platform, videoUrl: videoData.url });
      setTimeout(() => socialCache.delete(id), 600000);

      const captionText = buildCaption(platform, videoData.title);
      const keyboard = [[{ text: '📥 Video එක ලබාගන්න (Get Video)', callback_data: `soc_${id}_get` }]];

      if (videoData.thumb) {
        try { 
          await ctx.replyWithPhoto(videoData.thumb, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); 
          return; 
        } catch (e) {}
      }
      await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } else {
      return ctx.reply('❌ වීඩියෝ එක හොයාගන්න බැරි වුණා. Link එක Public එකක්ද හෝ නිවැරදිද කියා පරීක්ෂා කරන්න.');
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
    if (omdb.Response === 'False' && !myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');
    const title = omdb.Title || myMovie?.title || query;
    const poster = omdb.Poster && omdb.Poster !== 'N/A' ? omdb.Poster : null;
    const movieId = createId(); 
    movieCache.set(movieId, { query, title, myMovie, omdb }); 
    setTimeout(() => movieCache.delete(movieId), 600000);
    
    const photoSource = poster || (fs.existsSync(ALIVE_LOCAL_PATH) ? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : 'https://via.placeholder.com/300x450?text=No+Poster');
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
    await ctx.answerCbQuery('⏳ Downloading Video...');
    const parts = data.split('_');
    const id = parts[1];
    const qualityOrGet = parts[2]; // YouTube නම් quality (360, 720 ආදී), අනිත් ඒවාට 'get'
    
    const cached = socialCache.get(id); 
    if (!cached) return ctx.reply('⌛ Expired! නැවත Link එක එවන්න.');
    
    let videoLink = cached.videoUrl;
    if (cached.platform === 'youtube') {
      videoLink = await getCobaltDownloadLink(cached.url, qualityOrGet);
    }

    if (!videoLink) {
      return ctx.reply('❌ මෙම වීඩියෝ ලින්ක් එක ලබාගත නොහැක.');
    }
    
    const statusMsg = await ctx.reply(`⏳ Telegram එකට Upload වෙනවා...`);
    try {
      await ctx.replyWithVideo(videoLink, { caption: `✅ Done! POWERED BY CINEMAX` });
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    } catch (e) {
      try {
        const res = await fetch(videoLink);
        const buf = Buffer.from(await res.arrayBuffer());
        await ctx.replyWithVideo({ source: buf, filename: 'video.mp4' }, { caption: `✅ Done! POWERED BY CINEMAX` });
      } catch (err) {
        ctx.reply('❌ Video Upload කිරීම අසාර්ථක විය. (File එක විශාල වැඩි විය හැක)');
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
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); 
    } catch { 
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); 
      ctx.reply('❌ Fail.'); 
    } 
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
