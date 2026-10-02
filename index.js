const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OMDB_API = process.env.OMDB_API || 'c011220a';
// ඔයාගේ API එක
const MY_API_URL = 'https://raw.githubusercontent.com/hansaka56789/Moviebox_movieproAPI/main/output/api.json';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN not set!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ඔයාගේ API එකෙන් film එක හොයන function එක
async function searchMyAPI(movieName) {
  try {
    const res = await fetch(MY_API_URL);
    const data = await res.json();
    // data එක array එකක් නම්, නැත්තම් data.movies වගේ field එකක් නම් check කරනවා
    const movies = Array.isArray(data) ? data : data.movies || data.data || [];

    // නමට සමාන එකක් හොයනවා (case-insensitive)
    const found = movies.find(m => 
      (m.title || m.name || '').toLowerCase().includes(movieName.toLowerCase())
    );
    return found;
  } catch (e) {
    console.log('My API Error:', e.message);
    return null;
  }
}

bot.start((ctx) => ctx.reply('🎬 හන්සක MD Bot එකට ආයුබෝවන්!\n\nFilm එකක නමක් එවන්න, මම Poster එක + Download Link එක දෙන්නම්!\nඋදා: Avatar'));

bot.on('text', async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith('/')) return;

  await ctx.reply(`🔍 "${query}" හොයනවා...`);

  try {
    // 1. OMDB එකෙන් Details ගන්නවා
    const omdbUrl = `https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${OMDB_API}`;
    const omdbRes = await fetch(omdbUrl);
    const omdbData = await omdbRes.json();

    // 2. ඔයාගේ API එකෙන් Movie එක හොයනවා
    const myMovie = await searchMyAPI(query);

    if (omdbData.Response === 'False' && !myMovie) {
      return ctx.reply('😕 Film එක හම්බුනේ නෑ. වෙන නමකින් try කරන්න.');
    }

    // OMDB එක නැත්තම් ඔයාගේ API එකේ data විතරක් පාවිච්චි කරනවා
    const title = omdbData.Title || myMovie?.title || query;
    const year = omdbData.Year || myMovie?.year || '';
    const poster = omdbData.Poster !== 'N/A' ? omdbData.Poster : myMovie?.poster || null;
    
    let caption = `🎬 *${title}* ${year ? `(${year})` : ''}\n\n`;
    if (omdbData.Plot && omdbData.Plot !== 'N/A') caption += `📝 ${omdbData.Plot}\n\n`;
    if (omdbData.imdbRating && omdbData.imdbRating !== 'N/A') caption += `⭐ IMDb: ${omdbData.imdbRating}\n`;
    if (omdbData.Runtime && omdbData.Runtime !== 'N/A') caption += `⏱️ ${omdbData.Runtime}\n`;
    
    // ඔයාගේ API එකේ තියෙන download link එක
    let downloadLink = myMovie?.downloadUrl || myMovie?.link || myMovie?.url || myMovie?.streamUrl || null;
    
    // Inline Buttons හදනවා
    const buttons = [];
    if (downloadLink) {
      buttons.push([{ text: '📥 Full Movie Download / Watch', url: downloadLink }]);
    }
    if (myMovie?.telegramLink) {
      buttons.push([{ text: '📲 Telegram File', url: myMovie.telegramLink }]);
    }
    // ඔයාගේ site එකේ link එක default දානවා
    buttons.push([{ text: '🌐 Visit Hansaka.lk', url: 'https://hansaka.lk' }]);

    if (poster) {
      await ctx.replyWithPhoto(poster, {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    if (!downloadLink) {
        await ctx.reply('ℹ️ Full Movie එක මගේ API එකේ තාම නෑ. ඒත් Details ටික උඩ තියෙනවා. ඔයාගේ JSON එකට Add කරන්න.');
    }

  } catch (err) {
    console.error(err);
    ctx.reply('⚠️ Error එකක් ආවා: ' + err.message);
  }
});

bot.launch().then(() => console.log('Bot Started - Srggbhv_bot Online ✅'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
