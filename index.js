const { Telegraf } = require('telegraf');
const { aliveHandler } = require('./handlers/alive');
const { handleText, handleCallback } = require('./handlers/downloader');
const { handleDlCommand, handleDlCallback, isSocialCommand } = require('./handlers/social');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => aliveHandler(ctx));
bot.command('alive', (ctx) => aliveHandler(ctx));
bot.command('dl', (ctx) => handleDlCommand(ctx));

// Text routing: link එකක් නම් social downloader, නැත්නම් movie search
bot.on('text', (ctx) => {
  const text = ctx.message?.text || '';
  if (isSocialCommand(ctx)) return handleDlCommand(ctx);
  return handleText(ctx);
});

// Callback routing
bot.on('callback_query', (ctx) => {
  const data = ctx.callbackQuery?.data || '';
  if (data.startsWith('vid_') || data.startsWith('aud_')) {
    return handleDlCallback(ctx);
  }
  return handleCallback(ctx);
});

bot.launch().then(() => console.log('Bot Started ✅ Modular v7.0 + Social DL'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
