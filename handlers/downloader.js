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

// Cobalt API හරහා දත්ත ලබා ගැනීම (Instagram, TikTok, Facebook, YouTube සියල්ල සඳහා)
async function getCobaltData(url) {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        url: url,
        vCodec: 'h264',
        vQuality: '720',
        filenamePattern: 'classic'
      })
    });
    const data = await res.json();
    if (!data || data.status === 'error') return null;
    return data;
  } catch (e) {
    console.error('Cobalt Error:', e.message);
    return null;
  }
}

function buildCaption(platform, data) {
  const pName = platform.toUpperCase();
  const title = (data.title || 'No Title').toString().replace(/_/g, ' ').slice(0, 80);
  const author = data.author || 'Cinemax User';
  return `🟨🟥 ${pName} DOWNLOADER 🟥🟨\n\n🟡 Title: ${title}\n🔴 Author: ${author}\n\n⬇️ DOWNLOAD OPTIONS\n\n🔥 Direct Download Ready\n\n| 🌐 Web Site: cinemaxlk.vercel.app\n❤️💛 POWERED BY CINEMAX 💛❤️`;
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
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const id = createId();

    // Cobalt API මඟින් දත්ත ලබා ගැනීම
    const cobaltData = await getCobaltData(query);

    if (cobaltData && (cobaltData.url || cobaltData.picker)) {
      let videoUrls = [];
      
      // Picker එකක් තිබේ නම් (multiple items / images / videos)
      if (cobaltData.picker && cobaltData.picker.length > 0) {
        videoUrls = cobaltData.picker.map(p => p.url);
      } else if (cobaltData.url) {
        videoUrls.push(cobaltData.url);
      }

      let thumb = cobaltData.thumbnail || null;
      let title = cobaltData.filename || `${platform} Video`;

      const extracted = { title: title, author: `${platform} Creator`, thumb: thumb, links: videoUrls };

      socialCache.set(id, { platform, url: query, info: extracted, raw: cobaltData });
      setTimeout(() => socialCache.delete(id), 600000);

      const captionText = buildCaption(platform, extracted);
      const keyboard = [
        [{ text: '📥 Download Video', callback_data: `soc_${id}_dl` }]
      ];

      if (thumb) {
        try { 
          await ctx.replyWithPhoto(thumb, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); 
          return; 
        } catch (e) { 
          console.log('thumb fail, sending text'); 
        }
      }
      await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    return ctx.reply('❌ Video එක ලබා ගැනීමට නොහැකි විය. Link එක సరවැසි (Valid) එකක් සහ Public ද කියා පරීක්ෂා කරන්න.');
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
    await ctx.answerCbQuery('⏳ Downloading...');
    const parts = data.split('_'); 
    const id = parts[1];
    const cached = socialCache.get(id); 
    if (!cached) return ctx.reply('⌛ Expired. කරුණාකර නැවත Link එක එවන්න.');
    
    const statusMsg = await ctx.reply(`⏳ Uploading video...`);
    try {
      const links = cached.info.links;
      if (!links || links.length === 0) {
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
        return ctx.reply('❌ Download link එක ලබා ගැනීමට නොහැකි විය.');
      }

      // සියලුම links (లేదా පළමු link එක) එකින් එක හෝ එකක් ලෙස යැවීම
      for (let link of links) {
        try { 
          await ctx.replyWithVideo(link, { caption: `✅ Done! POWERED BY CINEMAX` }); 
        } catch (err) { 
          const res = await fetch(link); 
          const buf = Buffer.from(await res.arrayBuffer()); 
          await ctx.replyWithVideo({ source: buf, filename: 'video.mp4' }, { caption: `✅ Done! POWERED BY CINEMAX` }); 
        }
      }
      
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    } catch (e) { 
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); 
      ctx.reply('❌ Video එක යැවීමට නොහැකි විය. (File size එක වැඩි වැඩිදැයි පරීක්ෂා කරන්න)'); 
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
