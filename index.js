// index.js — Modular v7.7 (+ Baiscope Sinhala Subtitles /sub)
const { Telegraf } = require('telegraf');
const { aliveHandler } = require('./handlers/alive');
const { handleText, handleCallback } = require('./handlers/downloader');
const { handleDlCommand, handleDlCallback, isSocialCommand } = require('./handlers/social');
const { cacheMessage, cmdShare, cmdId } = require('./handlers/share');
const { cmdCinesubz, handleCszCallback } = require('./handlers/cinesubz');
const { cmdSinhalasub, handleSsCallback } = require('./handlers/sinhalasub');
const { cmdMoviebox, handleMbCallback } = require('./handlers/moviebox');
const { cmdYt, handleYtCallback } = require('./handlers/yt');
const { cmdSub, handleSubCallback } = require('./handlers/baiscope');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

/* ================= Local Bot API Server (2GB upload limit) =================
 * BOT_API_SERVER set කරාගෙත් cloud limit (50MB) වෙනුවට local server (2GB) එකෙන්
 * API calls යනවා. නැත්නම් cloud default (api.telegram.org) use වෙනවා.
 * උදා: BOT_API_SERVER=http://localhost:8081
 */
const API_ROOT = process.env.BOT_API_SERVER || 'https://api.telegram.org';

// Cloud token එකක් local server එකේ use කරනවා නම් මුලින්ම logOut + logIn ඕනෑ
async function registerLocalToken(apiRoot, token) {
  const axios = require('axios');
  try {
    await axios.get(`${apiRoot}/bot${token}/logOut`, { timeout: 10000 });
    console.log('🔑 Cloud එකෙන් token logOut ✅');
  } catch (e) {
    console.log('ℹ️ logOut:', e.response?.status || e.message);
  }
  try {
    const { data } = await axios.get(`${apiRoot}/bot${token}/logIn`, { timeout: 10000 });
    if (data.ok) console.log('🔑 Local server එකේ token logIn ✅');
    else console.log('⚠️ logIn:', data);
  } catch (e) {
    console.log('ℹ️ logIn:', e.response?.status || e.message);
  }
}

/* ================= Bot instance ================= */
const bot = new Telegraf(BOT_TOKEN, {
  apiRoot: API_ROOT,
  handlerTimeout: 900000, // 15 min — download+upload pipeline වලට
});

if (process.env.BOT_API_SERVER) {
  registerLocalToken(API_ROOT, BOT_TOKEN).then(() => {
    console.log(`🛠️ Local Bot API: ${API_ROOT}`);
  });
}

/* ================= Commands ================= */
bot.start((ctx) => aliveHandler(ctx));
bot.command('alive', (ctx) => aliveHandler(ctx));
bot.command('dl', (ctx) => handleDlCommand(ctx));
bot.command('yt', (ctx) => cmdYt(ctx));                    // YouTube search + download
bot.command('sub', (ctx) => cmdSub(ctx));                  // Baiscope සිංහල subtitles
bot.command('share', (ctx) => cmdShare(ctx));
bot.command('id', (ctx) => cmdId(ctx));
bot.command('cinesubz', (ctx) => cmdCinesubz(ctx));
bot.command('ss', (ctx) => cmdSinhalasub(ctx));          // sinhalasub.lk search
bot.command('mb', (ctx) => cmdMoviebox(ctx));            // MovieBox (themoviebox.xyz)

/* ================= Text routing ================= */
bot.on('text', (ctx) => {
  cacheMessage(ctx);
  const text = ctx.message?.text || '';
  if (isSocialCommand(ctx)) return handleDlCommand(ctx);
  return handleText(ctx);
});

/* ================= Media cache ================= */
['video', 'photo', 'document', 'animation'].forEach(t => {
  bot.on(t, (ctx) => cacheMessage(ctx));
});

/* ================= Callback routing ================= */
bot.on('callback_query', (ctx) => {
  const data = ctx.callbackQuery?.data || '';

  // Baiscope callbacks (bsc_)
  if (data.startsWith('bsc_')) return handleSubCallback(ctx);

  // YouTube callbacks (ytsel_ / ytv_ / yta_)
  if (data.startsWith('ytsel_') || data.startsWith('ytv_') || data.startsWith('yta_')) {
    return handleYtCallback(ctx);
  }

  // sinhalasub.lk callbacks (ss_ / ssq_)
  if (data.startsWith('ssq_')) return handleSsCallback(ctx); // quality → download+upload
  if (data.startsWith('ss_')) return handleSsCallback(ctx);  // movie → quality select

  // cinesubz callbacks (csz_ / cszq_)
  if (data.startsWith('cszq_')) return handleCszCallback(ctx); // quality → download+upload
  if (data.startsWith('csz_')) return handleCszCallback(ctx);  // movie → quality select

  // MovieBox callbacks (mb_ / mbq_)
  if (data.startsWith('mbq_')) return handleMbCallback(ctx); // quality → download+upload
  if (data.startsWith('mb_')) return handleMbCallback(ctx);  // movie → quality select

  if (data.startsWith('vid_') || data.startsWith('aud_')) {
    return handleDlCallback(ctx);
  }

  return handleCallback(ctx);
});

/* ================= Launch ================= */
bot.launch().then(() => console.log('Bot Started ✅ Modular v7.7 + Baiscope Subtitles'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
