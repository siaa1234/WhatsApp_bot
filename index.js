const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN missing!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    const movies = Array.isArray(data)? data : data.movies || data.data || [];
    return movies.find(m => (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase()));
  } catch (e) { return null; }
}

bot.start((ctx) => ctx.reply('🎬 හන්සක MD Bot Online!\nFilm එකක නමක් එවන්න 👇\nඋදා: Avatar'));

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith('/')) return;

  await ctx.reply(`🔍 "${query}" හොයනවා...`);

  try {
    const omdbRes = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`);
    const omdb = await omdbRes.json();
    const myMovie = await searchMyAPI(query);

    if (omdb.Response === 'False' &&!myMovie) {
      return ctx.reply('😕 Film එක හම්බුනේ නෑ. වෙන නමකින් try කරන්න.');
    }

    const title = omdb.Title || myMovie?.title || query;
    const poster = omdb.Poster && omdb.Poster!== 'N/A'? omdb.Poster : 'https://via.placeholder.com/300x450?text=No+Poster';

    let caption = `🎬 *${title}*\n`;
    if (omdb.Year) caption += `📅 ${omdb.Year}\n`;
    if (omdb.imdbRating && omdb.imdbRating!== 'N/A') caption += `⭐ IMDb: ${omdb.imdbRating}\n`;
    caption += `\nQuality එකක් තෝරන්න 👇`;

    await ctx.replyWithPhoto(poster, {
      caption: caption,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '360p', callback_data: `q_360p_${query}` },
            { text: '720p HD', callback_data: `q_720p_${query}` }
          ],
          [
            { text: '1080p FHD', callback_data: `q_1080p_${query}` },
            { text: '2K QHD', callback_data: `q_2k_${query}` }
          ],
          [
            { text: '🌐 Visit Hansaka.lk', url: 'https://hansaka.lk' }
          ]
        ]
      }
    });

  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ Error: ' + err.message);
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data; // q_720p_avatar
    const parts = data.split('_');
    const quality = parts[1]; // 360p, 720p, 1080p, 2k
    const movieName = parts.slice(2).join('_');

    await ctx.answerCbQuery(`${quality} Loading...`);

    const myMovie = await searchMyAPI(movieName);

    // ඔයාගේ API එකේ quality field එක මේ විදියට හදන්න
    // 360p -> myMovie['360p'] or myMovie.links['360p']
    const fileLink = myMovie?.[quality] || myMovie?.[quality + 'p'] || myMovie?.downloadUrl || myMovie?.url;

    if (fileLink) {
      await ctx.reply(`✅ *${movieName}* - ${quality.toUpperCase()} Ready!\n\n🔗 Link: ${fileLink}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📥 Download ${quality}`, url: fileLink }]
          ]
        }
      });
    } else {
      await ctx.reply(`❌ ${quality} මේ Film එකට නෑ. API එකේ Links Check කරන්න.\n\nFound: ${myMovie? Object.keys(myMovie).join(', ') : 'No Movie'}`);
    }
  } catch (e) {
    await ctx.reply('Error: ' + e.message);
  }
});

bot.launch().then(() => console.log('Bot Started with 360p/720p/1080p/2K ✅'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
