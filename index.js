const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Telegraf } = require('telegraf');
const { ttdl, igdl, fbdown } = require('btch-downloader');
const youtubedl = require('youtube-dl-exec');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');

const web = express();
web.get('/', (req, res) => res.send('Cinemax Bot Alive ✅'));
web.listen(process.env.PORT || 8000, () => console.log('Web server started'));

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';
const YT_API = 'https://api-dark-shan-yt.koyeb.app/download/ytmp4';
const ALIVE_LOCAL_PATH = path.join(__dirname, 'alive.jpg');
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

const socialCache = new Map();
const directCache = new Map();
const movieCache = new Map();
function createId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ============ WHATSAPP PAIRING SETUP ============
let waSocket = null;
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('wa_auth');
  waSocket = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false, browser: ['Cinemax', 'Chrome', '1.0'] });
  waSocket.ev.on('creds.update', saveCreds);
  waSocket.ev.on('connection.update', (u) => {
    if (u.connection === 'open') console.log('WhatsApp Paired ✅');
    if (u.connection === 'close') {
      if (u.lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) startWhatsApp();
    }
  });
}
startWhatsApp();
// ==============================================

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
const escapeHtml = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ytExtraOpts() { return fs.existsSync(COOKIES_PATH)? { cookies: COOKIES_PATH } : {}; }
async function getYouTubeInfo(url) {
  try { return await youtubedl(url, { dumpSingleJson: true, noWarnings: true, noPlaylist: true, noCheckCertificates: true,...ytExtraOpts() }); }
  catch (e) { console.error('YT info error:', e.message); return null; }
}
async function downloadYouTube(url, quality) {
  const base = `yt_${createId()}`;
  await youtubedl(url, { format: `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/b[height<=${quality}][ext=mp4]/b[height<=${quality}]/b`, mergeOutputFormat: 'mp4', output: path.join(os.tmpdir(), `${base}.%(ext)s`), noPlaylist: true, noWarnings: true, noCheckCertificates: true,...ytExtraOpts() });
  const file = fs.readdirSync(os.tmpdir()).find(f => f.startsWith(base));
  if (!file) throw new Error('Downloaded file not found');
  return path.join(os.tmpdir(), file);
}
async function getSocialLinks(platform, url) {
  try { if (platform === 'tiktok') return await ttdl(url); if (platform === 'instagram') return await igdl(url); if (platform === 'facebook') return await fbdown(url); }
  catch (e) { console.error('Social API error:', e.message); } return null;
}
function pickSocialQuality(info, quality) {
  if (!info) return null; const resultObj = info.data || info.result || info; let item = Array.isArray(resultObj)? resultObj[0] : resultObj; if (!item) return null;
  let linksList = item.video || item.url || item.download || item.links || item;
  if (Array.isArray(linksList)) { const found = linksList.find(v => (v.quality || '').toLowerCase().includes(quality)); if (found && found.url) return found.url; return linksList[0].url || linksList[0]; }
  if (typeof linksList === 'object' && linksList!== null) return linksList[quality] || linksList.hd || linksList.sd || linksList.url;
  if (typeof linksList === 'string') return linksList; return null;
}
async function searchMyAPI(movieName) {
  try { const res = await fetch(MY_API_URL); const data = await res.json(); const movies = Array.isArray(data)? data : data.movies || data.data || []; return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase())); }
  catch (e) { return null; }
}

bot.start(async (ctx) => {
  const userName = ctx.from.first_name || 'User'; const now = new Date(); const date = now.toLocaleDateString('en-GB'); const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const caption = `👋 HI, ${userName} [•_•] I AM Active NOW 👾\n\n╭─「 DATE 」\n│📅 Date: ${date}\n│⏰ Time: ${time}\n╰──────────●●►\n╭─「 STATUS 」\n│👤 User: ${userName}\n│🧬 Version: 7.0.0 Pair Edition\n│📱 WhatsApp: Ready to Pair\n╰──────────●●►\n╭─「 OUR film site 」\n│🚀 cinemaxlk.vercel.app\n╰──────────●●►\n\n*WhatsApp Pair කරන්න:*\n\`pair 9471xxxxxxx\` කියලා එවන්න`;
  try {
    if (fs.existsSync(ALIVE_LOCAL_PATH)) {
      await ctx.replyWithPhoto({ source: fs.createReadStream(ALIVE_LOCAL_PATH) }, { caption: caption, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🎬 Search Movie', switch_inline_query_current_chat: '' }], [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]] } });
    } else { await ctx.reply(caption, { parse_mode: 'Markdown' }); }
  } catch (e) { await ctx.reply(caption, { parse_mode: 'Markdown' }); }
});

// PAIR COMMAND - අලුතෙන් දැම්මේ
bot.hears(/^pair\s+([0-9]+)$/i, async (ctx) => {
  const phoneNumber = ctx.match[1].replace(/[^0-9]/g, '');
  if (!waSocket) return ctx.reply('❌ WhatsApp Socket Ready නෑ. තත් 5කින් ආයෙ try කරන්න.');
  await ctx.reply(`⏳ ${phoneNumber} ට Pair Code එක හදනවා...`);
  try {
    const code = await waSocket.requestPairingCode(phoneNumber);
    await ctx.reply(`✅ *WhatsApp Pair Code:*\n\n\`${code}\`\n\n1. WhatsApp > Settings > Linked Devices\n2. Link a Device > Link with phone number\n3. Code එක දාන්න: *${code}*\n\nCode එක තත් 60න් expire වෙනවා!`, { parse_mode: 'Markdown' });
  } catch (e) { console.error(e); ctx.reply('❌ Pair කරන්න බැරිවුණා. Number එක 9471... විදියට දාන්න. Ex: pair 94712345678'); }
});

bot.on('text', async (ctx) => {
  const query = ctx.message.text?.trim(); if (!query || query.startsWith('/') || query.toLowerCase().startsWith('pair')) return;
  const platform = detectPlatform(query);
  if (platform) {
    await ctx.reply(`🔍 ${platform.toUpperCase()} video එක analyze කරනවා...`); const id = createId();
    if (platform === 'youtube') {
      const yt = await getYouTubeInfo(query); if (!yt) return ctx.reply('❌ YouTube video එක ලබාගැනීමට නොහැකි විය.');
      socialCache.set(id, { platform: 'youtube', url: query, info: { title: yt.title, uploader: yt.uploader || yt.channel } }); setTimeout(() => socialCache.delete(id), 600000);
      const keyboard = [[{ text: '144p', callback_data: `soc_${id}_144` }, { text: '360p', callback_data: `soc_${id}_360` }, { text: '480p', callback_data: `soc_${id}_480` }], [{ text: '720p HD', callback_data: `soc_${id}_720` }, { text: '1080p FHD', callback_data: `soc_${id}_1080` }]];
      const mins = yt.duration? `${Math.floor(yt.duration / 60)}:${String(yt.duration % 60).padStart(2, '0')}` : 'N/A';
      const captionText = `🎬 <b>${escapeHtml(yt.title)}</b>\n\n👤 <b>Channel:</b> ${escapeHtml(yt.uploader || yt.channel)}\n👁️ <b>Views:</b> ${yt.view_count?? 'N/A'}\n⏱️ <b>Duration:</b> ${mins}\n\n👇 අවශ්‍ය Quality එක තෝරන්න:`;
      const opts = { caption: captionText, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
      if (yt.thumbnail) { try { await ctx.replyWithPhoto(yt.thumbnail, opts); return; } catch (err) {} }
      await ctx.reply(captionText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }); return;
    }
    const info = await getSocialLinks(platform, query); if (!info) return ctx.reply('❌ Video එක හම්බුනේ නෑ. Link එක public ද කියලා check කරන්න.');
    socialCache.set(id, { platform, url: query, info }); setTimeout(() => socialCache.delete(id), 600000);
    const resultObj = info.data || info.result || info; const item = Array.isArray(resultObj)? resultObj[0] : resultObj;
    const title = item?.title || 'Unknown Title'; const author = item?.author || item?.channel || 'Unknown';
    const keyboard = [[{ text: '📥 HD Video', callback_data: `soc_${id}_hd` }, { text: '📥 SD Video', callback_data: `soc_${id}_sd` }]];
    const captionText = `🎬 <b>${escapeHtml(title)}</b>\n\n👤 <b>Creator:</b> ${escapeHtml(author)}\n\n👇 Quality තෝරන්න:`;
    await ctx.reply(captionText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }); return;
  }
  const directType = detectDirectLink(query);
  if (directType) {
    let finalUrl = query; if (directType === 'gdrive') finalUrl = convertGoogleDriveLink(query);
    const id = createId(); directCache.set(id, { url: finalUrl }); setTimeout(() => directCache.delete(id), 600000);
    await ctx.reply(`🔗 Link එක හඳුනාගැනිණි!`, { reply_markup: { inline_keyboard: [[{ text: '📥 Send as Video', callback_data: `send_${id}` }]] } }); return;
  }
  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  try {
    const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`); const omdb = await omdbRes.json(); const myMovie = await searchMyAPI(query);
    if (omdb.Response === 'False' &&!myMovie) return ctx.reply('❌ Film එක හම්බුනේ නෑ');
    const title = omdb.Title || myMovie?.title || query; const poster = omdb.Poster && omdb.Poster!== 'N/A'? omdb.Poster : null;
    const movieId = createId(); movieCache.set(movieId, { query, title, myMovie, omdb }); setTimeout(() => movieCache.delete(movieId), 600000);
    const photoSource = poster || (fs.existsSync(ALIVE_LOCAL_PATH)? { source: fs.createReadStream(ALIVE_LOCAL_PATH) } : 'https://via.placeholder.com/300x450?text=No+Poster');
    await ctx.replyWithPhoto(photoSource, { caption: `🎬 ${title}\nQuality එකක් තෝරන්න 👇`, reply_markup: { inline_keyboard: [[{ text: '480p', callback_data: `mq_${movieId}_480p` }, { text: '720p HD', callback_data: `mq_${movieId}_720p` }], [{ text: '1080p Full HD', callback_data: `mq_${movieId}_1080p` }], [{ text: '🌐 Visit Site', url: 'https://cinemaxlk.vercel.app' }]] } });
  } catch (e) { ctx.reply('❌ Error එකක් ආවා.'); }
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('soc_')) {
    await ctx.answerCbQuery('⏳ Downloading...'); const [, id, quality] = data.split('_'); const cached = socialCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired.'); const statusMsg = await ctx.reply('⏳ Video එක Download කරමින්...');
    const deleteStatus = () => ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    if (cached.platform === 'youtube') {
      let filePath;
      try {
        try { const apiRes = await fetch(`${YT_API}?url=${encodeURIComponent(cached.url)}&quality=${quality}`); const apiData = await apiRes.json(); const directLink = apiData.download_url || apiData.url || apiData.link; if (directLink) { await ctx.replyWithVideo(directLink, { caption: `✅ ${cached.info.title} (${quality}p)` }); await deleteStatus(); return; } } catch (e) { }
        filePath = await downloadYouTube(cached.url, quality); const sizeMB = fs.statSync(filePath).size / 1024 / 1024;
        if (sizeMB > 49) { await deleteStatus(); return ctx.reply(`❌ File එක ${sizeMB.toFixed(1)}MB. 50MB limit.`); }
        await ctx.replyWithVideo({ source: fs.createReadStream(filePath), filename: 'video.mp4' }, { caption: `✅ ${cached.info.title} (${quality}p)`, supports_streaming: true }); await deleteStatus();
      } catch (e) { await deleteStatus(); ctx.reply('❌ Download අසාර්ථකයි.'); } finally { if (filePath) fs.unlink(filePath, () => {}); } return;
    }
    const link = pickSocialQuality(cached.info, quality);
    try { if (!link) throw new Error('No link'); await ctx.replyWithVideo(link, { caption: `✅ Uploaded! (${quality.toUpperCase()})` }); }
    catch (e) { try { const response = await fetch(link); const buffer = Buffer.from(await response.arrayBuffer()); await ctx.replyWithVideo({ source: buffer, filename: 'video.mp4' }, { caption: '✅ Uploaded!' }); } catch (err) { await ctx.reply('❌ Upload අසාර්ථකයි.'); } }
    await deleteStatus(); return;
  }
  if (data.startsWith('send_')) {
    await ctx.answerCbQuery('⏳ Downloading...'); const id = data.split('_')[1]; const cached = directCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired.'); const statusMsg = await ctx.reply('⏳ Uploading...');
    const deleteStatus = () => ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    try { const response = await fetch(cached.url); const buffer = Buffer.from(await response.arrayBuffer()); await ctx.replyWithVideo({ source: buffer, filename: 'video.mp4' }, { caption: '✅ Done!' }); await deleteStatus(); }
    catch (e) { await deleteStatus(); ctx.reply('❌ Upload fail. File >50MB maybe.'); } return;
  }
  if (data.startsWith('mq_')) {
    await ctx.answerCbQuery(); const [, id, quality] = data.split('_'); const cached = movieCache.get(id);
    if (!cached) return ctx.reply('⌛ Session expired.'); await ctx.reply(`⏳ ${cached.title} - ${quality} ලෝඩ් කරනවා...`);
    const fileLink = cached.myMovie?.[quality] || cached.myMovie?.links?.[quality] || cached.myMovie?.downloadUrl || cached.myMovie?.url;
    if (fileLink) { await ctx.reply(`✅ ${cached.title} - ${quality} Ready!\n\n🔗 ${fileLink}`, { reply_markup: { inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]] } }); }
    else { await ctx.reply(`❌ ${quality} DB එකේ නෑ.`); } return;
  }
});

bot.launch().then(() => console.log('Bot Started ✅ Pair Edition'));
process.once('SIGINT', () => bot.stop('SIGINT')); process.once('SIGTERM', () => bot.stop('SIGTERM'));
