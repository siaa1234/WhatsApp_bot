const { Telegraf } = require('telegraf');
const { aliveHandler } = require('./handlers/alive');
const { handleText, handleCallback } = require('./handlers/downloader');
const { handleDlCommand, handleDlCallback, isSocialCommand } = require('./handlers/social');
const { cacheMessage, cmdShare, cmdId } = require('./handlers/share');
const { cmdCinesubz, handleCszCallback } = require('./handlers/cinesubz');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => aliveHandler(ctx));
bot.command('alive', (ctx) => aliveHandler(ctx));
bot.command('dl', (ctx) => handleDlCommand(ctx));
bot.command('share', (ctx) => cmdShare(ctx));
bot.command('id', (ctx) => cmdId(ctx));
bot.command('cinesubz', (ctx) => cmdCinesubz(ctx));

// Text routing: link එකක් නම් social downloader, නැත්නම් movie search
bot.on('text', (ctx) => {
  cacheMessage(ctx);
  const text = ctx.message?.text || '';
  if (isSocialCommand(ctx)) return handleDlCommand(ctx);
  return handleText(ctx);
});

// Video/media messages cache කරනවා (reply-forward වලට)
['video', 'photo', 'document', 'animation'].forEach(t => {
  bot.on(t, (ctx) => cacheMessage(ctx));
});

// Callback routing
bot.on('callback_query', (ctx) => {
  const data = ctx.callbackQuery?.data || '';
  if (data.startsWith('csz_')) {
    return handleCszCallback(ctx);
  }
  if (data.startsWith('vid_') || data.startsWith('aud_')) {
    return handleDlCallback(ctx);
  }
  return handleCallback(ctx);
});

bot.launch().then(() => console.log('Bot Started ✅ Modular v7.2'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
