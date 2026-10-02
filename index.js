const { Telegraf } = require("telegraf")

const bot = new Telegraf(process.env.BOT_TOKEN)
const OMDB_API = process.env.OMDB_API || "c011220a"

bot.start((ctx) => ctx.reply("🎬 Hansaka MD Movie Bot Online!\n\nFilm එකේ නම එවන්න, මම විස්තර දෙන්නම්!"))

bot.on("text", async (ctx) => {
  const movieName = ctx.message.text
  if (movieName.startsWith("/")) return

  try {
    await ctx.sendChatAction('typing')
    const url = `http://www.omdbapi.com/?t=${encodeURIComponent(movieName)}&apikey=${OMDB_API}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.Response === "False") {
      return ctx.reply(`❌ "${movieName}" හම්බුනේ නෑ. වෙන නමක් try කරන්න.`)
    }

    const caption = `🎬 *${data.Title}* (${data.Year})\n\n⭐ *IMDb:* ${data.imdbRating}/10\n🎭 *Genre:* ${data.Genre}\n⏱️ *Runtime:* ${data.Runtime}\n📅 *Released:* ${data.Released}\n\n📝 *Plot:*\n${data.Plot}\n\n👥 *Actors:* ${data.Actors}`

    if (data.Poster && data.Poster !== "N/A") {
      await ctx.replyWithPhoto(data.Poster, { caption: caption, parse_mode: 'Markdown' })
    } else {
      await ctx.reply(caption, { parse_mode: 'Markdown' })
    }

  } catch (e) {
    console.log(e)
    ctx.reply("Error එකක් ආවා බං, පස්සේ try කරන්න.")
  }
})

bot.launch()
console.log("Movie Bot Started!")
