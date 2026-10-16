const { Telegraf } = require('telegraf');
const { aliveHandler } = require('./handlers/alive');
const { handleText, handleCallback } = require('./handlers/downloader');
const { handleDlCommand, handleDlCallback, isSocialCommand } = require('./handlers/social');
const { cacheMessage, cmdShare, cmdId } = require('./handlers/share');
const { cmdCinesubz, handleCszCallback } = require('./handlers/cinesubz');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

/* ================= Local Bot API Server (2GB upload limit) =================
 * BOT_API_SERVER set කරාොත් cloud limit (50MB) වෙනුවට local server (2GB) එකෙන්
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
    // "404 Unauthorized" or already local — ignore, දැනටමත් local server එකේ නම් OK
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
  // ලොකු file uploads වලට connection එක long-lived වෙන්න ඕනෑ
  handlerTimeout: 900000, // 15 min — download+upload pipeline වලට
});

// Local server use කරොත් token register කරන්න (one-time)
if (process.env.BOT_API_SERVER) {
  registerLocalToken(API_ROOT, BOT_TOKEN).then(() => {
    console.log(`🛠️ Local Bot API: ${API_ROOT}`);
  });
}

/* ================= Commands ================= */
bot.start((ctx) => aliveHandler(ctx));
bot.command('alive', (ctx) => aliveHandler(ctx));
bot.command('dl', (ctx) => handleDlCommand(ctx));
bot.command('share', (ctx) => cmdShare(ctx));
bot.command('id', (ctx) => cmdId(ctx));
bot.command('cinesubz', (ctx) => cmdCinesubz(ctx));

/* ================= Text routing =================
 * link එකක් නම් social downloader, නැත්නම් movie search
 */
bot.on('text', (ctx) => {
  cacheMessage(ctx);
  const text = ctx.message?.text || '';
  if (isSocialCommand(ctx)) return handleDlCommand(ctx);
  return handleText(ctx);
});

/* ================= Media cache (reply-forward වලට) ================= */
['video', 'photo', 'document', 'animation'].forEach(t => {
  bot.on(t, (ctx) => cacheMessage(ctx));
});

/* ================= Callback routing ================= */
bot.on('callback_query', (ctx) => {
  const data = ctx.callbackQuery?.data || '';

  if (data.startsWith('cszq_')) return handleCszCallback(ctx); // quality → download+upload
  if (data.startsWith('csz_')) return handleCszCallback(ctx);  // movie → quality select

  if (data.startsWith('vid_') || data.startsWith('aud_')) {
    return handleDlCallback(ctx);
  }

  return handleCallback(ctx);
});

/* ================= Launch ================= */
bot.launch().then(() => console.log('Bot Started ✅ Modular v7.3'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
