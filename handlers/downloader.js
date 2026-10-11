const fs = require('fs');
const path = require('path');
const { ttdl, igdl, fbdown } = require('btch-downloader');

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
  const fileId = match? (match[1] || match[2]) : null;
  if (fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  return url;
}
async function getCobaltData(url) {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    return await res.json();
  } catch (e) { return null; }
}
async function getSocialLinks(platform, url) {
  try {
    if (platform === 'tiktok') return await ttdl(url);
    if (platform === 'instagram') return await igdl(url);
    if (platform === 'facebook') return await fbdown(url);
  } catch (e) {}
  return null;
}
function extractSocialData(info) {
  if (!info) return null;
  const resultObj = info.data || info.result || info;
  let item = Array.isArray(resultObj)? resultObj[0] : resultObj;
  if (!item) return null;
  return {
    title: item.title || item.caption || item.description || 'No Title',
    author: item.author || item.username || item.channel || item.owner || 'Unknown',
    duration: item.duration || item.durationSeconds || 'N/A',
    thumb: item.thumb || item.thumbnail || item.cover || null,
    links: item.video || item.url || item.download || item.links || item
  };
}
async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data)? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) { return null; }
}

// ========== NEW DESIGN CAPTION ==========
function buildCaption(platform, data) {
  const pName = platform.toUpperCase();
  const title = (data.title || 'No Title').toString().slice(0, 60);
  const author = data.author || 'Unknown';
  const duration = data.duration || 'N/A';

  return `😘 ${pName}  DOWNLOADER

■ 📝 Title: _${title}_
■ 👤 Author: ${author}
■ ⏱️ Duration: ${duration} seconds

⬇️ DOWNLOAD OPTIONS

HD No Watermark
No Watermark
Audio Only

| 👨‍💻 Web Site: cinemaxlk.vercel.app
POWERED BY CINEMAX`;
}

async function handleText(ctx) {
  const query = ctx.message.text?.trim();
  if (!query || query.startsWith('/')) return;

  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`);
    const id = createId();

    if (platform === 'youtube') {
      const ytData = await getCobaltData(query);
      if (!ytData || (!ytData.url &&!ytData.picker)) return ctx.reply('❌ YouTube video එක ලබාගැනීමට නොහැකි විය.');

      const extracted = { title: ytData.filename || 'YouTube Video', author: 'YouTube Creator', duration: 'N/A', thumb: ytData.thumbnail };
      socialCache.set(id, { platform: 'youtube', url: query, info: extracted, raw: ytData });
      setTimeout(() => socialCache.delete(id), 600000);

      const captionText = buildCaption(platform, extracted);
      const keyboard = [
        [{ text: 'HD No Watermark', callback_data: `soc_${id}_1080` }],
        [{ text: 'No Watermark', callback_data: `soc_${id}_720` }],
        [{ text: 'Audio Only', callback_data: `soc_${id}_audio` }]
      ];

      if (ytData.thumbnail) {
        try { await ctx.replyWithPhoto(ytData.thumbnail, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); return; } catch {}
      }
      await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
      return;
    }

    const info = await getSocialLinks(platform, query);
    const extracted = extractSocialData(info);
    if (!extracted) return ctx.reply('❌ Video එක හම්බුනේ නෑ.');

    socialCache.set(id, { platform, url: query, info: extracted });
    setTimeout(() => socialCache.delete(id), 600000);

    const captionText = buildCaption(platform, extracted);
    const keyboard = [
      [{ text: 'HD No Watermark', callback_data: `soc_${id}_hd` }],
      [{ text: 'No Watermark', callback_data: `soc_${id}_sd` }],
      [{ text: 'Audio Only', callback_data: `soc_${id}_audio` }]
    ];

    if (extracted.thumb) {
      try { await ctx.replyWithPhoto(extracted.thumb, { caption: captionText, reply_markup: { inline_keyboard: keyboard } }); return; } catch {}
    }
    await ctx.reply(captionText, { reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  // Direct & Movie Search (same as before)
  const directType = detectDirectLink(query);
  if (directType) {
    let finalUrl = query; if (directType === 'gdrive') finalUrl = convertGoogleDriveLink(query);
    const id = createId(); directCache.set(id, { url: finalUrl }); setTimeout(() => directCache.delete(id), 600000);
    await ctx.reply(`🔗 Link එක හඳුනාගැනිණි!`, { reply_markup: { inline_keyboard: [[{ text: '📥 Send as Video', callback_data: `send_${id}` }]] } }); return;
  }

  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try {
    const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
    const omdb = await omdbRes.json();
    const myMovie = await searchMyAPI(query);
    if (omdb.Response === 'False' &&!myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');
    const title = omdb.Title || myMovie?.title || query;
    const poster = omdb.Poster && omdb.Poster!== 'N/A'? omdb.Poster : null;
    const movieId = createId(); movieCache.set(movieId, { query, title, myMovie, omdb }); setTimeout(() => movieCache.delete(movieId), 600000);
    const photoSource = poster || (fs.existsSync(ALIVE_LOCAL_PATH)? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : 'https://via.placeholder.com/300x450?text=No+Poster');
    await ctx.replyWithPhoto(photoSource, { caption: `🎬 ${title}\nQuality තෝරන්න 👇`, reply_markup: { inline_keyboard: [[{ text: '480p', callback_data: `mq_${movieId}_480p` }, { text: '720p HD', callback_data: `mq_${movieId}_720p` }], [{ text: '1080p Full HD', callback_data: `mq_${movieId}_1080p` }], [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]] } });
  } catch (e) { ctx.reply('❌ Error එකක් ආවා.'); }
}

async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('soc_')) {
    await ctx.answerCbQuery('⏳ Downloading...'); const parts = data.split('_'); const id = parts[1]; const quality = parts[2];
    const cached = socialCache.get(id); if (!cached) return ctx.reply('⌛ Expired.');
    const statusMsg = await ctx.reply(`⏳ ${quality} Uploading...`);
    try {
      let link = null;
      if (cached.platform === 'youtube') { const raw = cached.raw || await getCobaltData(cached.url); link = raw?.url || raw?.picker?.find(p=>p.url)?.url || raw?.picker?.[0]?.url; }
      else {
        const linksList = cached.info.links;
        if (Array.isArray(linksList)) { link = linksList[0]?.url || linksList[0]; }
        else if (typeof linksList === 'object') { link = linksList.hd || linksList.sd || linksList.url; }
        else { link = linksList; }
      }
      if (!link) { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); return ctx.reply('❌ Link එක ගන්න බෑ.'); }
      try { await ctx.replyWithVideo(link, { caption: `✅ Done! POWERED BY CINEMAX` }); }
      catch { const res = await fetch(link); const buf = Buffer.from(await res.arrayBuffer()); await ctx.replyWithVideo({ source: buf, filename: 'video.mp4' }, { caption: `✅ Done! POWERED BY CINEMAX` }); }
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{});
    } catch { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); ctx.reply('❌ Upload fail.'); } return;
  }
  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Downloading...'); const id = data.split('_')[1]; const cached = directCache.get(id);
    if (!cached) return ctx.reply('⌛ Expired.'); const statusMsg = await ctx.reply(`⏳ Uploading...`);
    try { await ctx.replyWithVideo(cached.url, { caption: `✅ Done! POWERED BY CINEMAX` }); await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); } catch { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(()=>{}); ctx.reply('❌ Fail.'); } return;
  }
  if (data.startsWith('mq_')) {
    await ctx.answerCbQuery(); const parts = data.split('_'); const id = parts[1]; const quality = parts[2]; const cached = movieCache.get(id);
    if (!cached) return ctx.reply('⌛ Expired.'); const fileLink = cached.myMovie?.[quality] || cached.myMovie?.links?.[quality] || cached.myMovie?.downloadUrl;
    if (fileLink) await ctx.reply(`✅ ${cached.title} - ${quality} Ready!\n\n🔗 ${fileLink}`, { reply_markup: { inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]] } });
    else await ctx.reply(`❌ ${quality} නෑ.`); return;
  }
}

module.exports = { handleText, handleCallback };
