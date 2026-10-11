const fs = require('fs');
const path = require('path');

const OMDB_API = process.env.OMDB_API || 'c011220a';
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

// Multi-API Fetcher (SnapSave, Rapid/Public Downloader, Cobalt Fallback)
async function fetchSocialMediaVideo(url, platform) {
  // Method 1: SnapSave/SaveFrom Universal API
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

  // Method 2: Public Auto-Downloader API
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

  // Method 3: Public Cobalt alternative mirror
  try {
    const res3 = await fetch('https://cobalt-api.kwiatek.xyz/', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, videoQuality: '720' })
    });
    const data3 = await res3.json();
    if (data3 && data3.url) {
      return {
        url: data3.url,
        title: `${platform} Video`,
        thumb: data3.thumbnail || null
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
    const statusMsg = await ctx.reply(`🔍 ${platform.toUpperCase()} වීඩියෝ එක Download කිරීමට සූදානම් කරනවා...`);
    const id = createId();

    const videoData = await fetchSocialMediaVideo(query, platform);

    if (videoData && videoData.url) {
      socialCache.set(id, { platform, videoUrl: videoData.url });
      setTimeout(() => socialCache.delete(id), 600000);

      const captionText = buildCaption(platform, videoData.title);
      const keyboard = [[{ text: '📥 Video එක ලබාගන්න (Get Video)', callback_data: `soc_${id}_get` }]];

      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}

      if (videoData.thumb) {
        try { 
          await ctx.replyWithPhoto(videoData.thumb, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); 
          return; 
        } catch (e) {}
      }
      await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } else {
      try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch(e) {}
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
    const id = data.split('_')[1];
    const cached = socialCache.get(id); 
    if (!cached) return ctx.reply('⌛ Expired! නැවත Link එක එවන්න.');
    
    const statusMsg = await ctx.reply(`⏳ Telegram එකට Upload වෙනවා...`);
    try {
      await ctx.replyWithVideo(cached.videoUrl, { caption: `✅ Done! POWERED BY CINEMAX` });
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    } catch (e) {
      try {
        // Direct link send failed නම් stream එකෙන් යවනවා
        const res = await fetch(cached.videoUrl);
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
