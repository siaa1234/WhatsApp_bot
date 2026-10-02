const { Telegraf } = require('telegraf');
const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';

const bot = new Telegraf(BOT_TOKEN);

// ඔයාගේ API එක
async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) { return null; }
}

bot.start((ctx) => ctx.reply('🎬 Bot Online! Film නමක් එවන්න'));

// 1. Film එකක් ගහපු ගමන් Quality Buttons පෙන්නනවා
bot.on('text', async (ctx) => {
  const query = ctx.message.text;
  if (query.startsWith('/')) return;

  await ctx.reply(`🔍 "${query}" හොයනවා...`);
  
  const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
  const omdb = await omdbRes.json();
  const myMovie = await searchMyAPI(query);

  if (omdb.Response === 'False' && !myMovie) return ctx.reply('Film එක හම්බුනේ නෑ');

  const title = omdb.Title || myMovie.title;
  const poster = omdb.Poster !== 'N/A' ? omdb.Poster : null;
  
  // මෙන්න Quality Buttons ටික දාන තැන
  await ctx.replyWithPhoto(poster || 'https://via.placeholder.com/300x450?text=No+Poster', {
    caption: `🎬 *${title}*\nQuality එකක් තෝරන්න 👇`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '480p', callback_data: `q_480p_${query}` }],
        [{ text: '720p HD', callback_data: `q_720p_${query}` }],
        [{ text: '1080p Full HD', callback_data: `q_1080p_${query}` }],
        [{ text: '🌐 Visit Site', url: 'https://hansaka.lk' }]
      ]
    }
  });
});

// 2. Quality එකක් Click කරපු ගමන් වැඩ කරන තැන - මේක index.js එකේ යටම තියෙන්න ඕන
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data; // උදා: q_720p_avatar
  const [_, quality, movieName] = data.split('_');
  
  await ctx.answerCbQuery();
  await ctx.reply(`⏳ ${movieName} - ${quality} ලෝඩ් කරනවා...`);

  const myMovie = await searchMyAPI(movieName);
  
  // ඔයාගේ API එකේ quality අනුව link වෙනස් නම් මෙතන හදන්න
  // උදා: myMovie.links[quality]
  const fileLink = myMovie?.[quality] || myMovie?.downloadUrl || myMovie?.url;

  if (fileLink) {
    // Link එක 2GB ට වඩා අඩු නම් Video එකක් විදියට යවනවා
    // නැත්තම් Button එකක් විදියට යවනවා
    await ctx.reply(`✅ ${quality} Ready!\n\n🔗 ${fileLink}`, {
      reply_markup: {
        inline_keyboard: [[{ text: `📥 Download ${quality}`, url: fileLink }]]
      }
    });
  } else {
    await ctx.reply('❌ මේ Quality එක මගේ DB එකේ නෑ');
  }
});

bot.launch().then(() => console.log('Bot Started ✅'));
