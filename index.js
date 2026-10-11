const { Telegraf } = require('telegraf');
const { aliveHandler } = require('./handlers/alive');
const { handleText, handleCallback } = require('./handlers/downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN not set!');

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => aliveHandler(ctx));
bot.command('alive', (ctx) => aliveHandler(ctx));

bot.on('text', (ctx) => handleText(ctx));
bot.on('callback_query', (ctx) => handleCallback(ctx));

bot.launch().then(() => console.log('Bot Started ✅ Modular v6.0'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
